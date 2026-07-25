const LIVE_STREAMS = {
  foorti: "https://radiofoorti.fm/api/stream",
  jago: "http://139.59.86.99:12496/stream",
} as const;

export async function GET(request: Request) {
  const station = new URL(request.url).searchParams.get("station");
  // `in` also matches inherited keys, so "constructor" or "toString" would pass
  // the allowlist check and reach fetch(). Own-property lookup cannot.
  if (!station || !Object.hasOwn(LIVE_STREAMS, station)) {
    return Response.json({ error: "Unknown radio station" }, { status: 404 });
  }
  const streamUrl = LIVE_STREAMS[station as keyof typeof LIVE_STREAMS];

  // A radio stream never ends, so the timeout must cover only the handshake.
  // Aborting the signal also cancels the response body, so the timer has to be
  // cleared the moment headers arrive — otherwise playback dies mid-song.
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = await fetch(streamUrl, {
      headers: {
        Accept: "audio/mpeg,audio/aac,*/*;q=0.8",
        "Icy-MetaData": "0",
        "User-Agent": "BirdsEyeView/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(connectTimer);
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Station is currently unavailable" }, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    clearTimeout(connectTimer);
    return Response.json({ error: "Station is currently unavailable" }, { status: 502 });
  }
}
