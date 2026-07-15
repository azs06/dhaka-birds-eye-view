const LIVE_STREAMS = {
  foorti: "https://radiofoorti.fm/api/stream",
  jago: "http://139.59.86.99:12496/stream",
} as const;

export async function GET(request: Request) {
  const station = new URL(request.url).searchParams.get("station") as keyof typeof LIVE_STREAMS | null;
  if (!station || !(station in LIVE_STREAMS)) {
    return Response.json({ error: "Unknown radio station" }, { status: 404 });
  }

  try {
    const upstream = await fetch(LIVE_STREAMS[station], {
      headers: {
        Accept: "audio/mpeg,audio/aac,*/*;q=0.8",
        "Icy-MetaData": "0",
        "User-Agent": "BirdsEyeView/1.0",
      },
      redirect: "follow",
    });
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
    return Response.json({ error: "Station is currently unavailable" }, { status: 502 });
  }
}
