const LOCATION = { lat: 23.7715, lon: 90.4165 };
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 5 * 60 * 1_000;

type WeatherMode = "clear" | "cloudy" | "fog" | "drizzle" | "rain" | "storm";
type OpenMeteoResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    rain?: number;
    showers?: number;
    weather_code?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
};

type WeatherPayload = {
  source: "Open-Meteo";
  fetchedAt: string;
  observedAt: string;
  mode: WeatherMode;
  label: string;
  weatherCode: number;
  isDay: boolean;
  temperature: number;
  apparentTemperature: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
};

let cachedWeather: WeatherPayload | null = null;
let cachedUntil = 0;
let inFlightRequest: Promise<WeatherPayload> | null = null;

function describeWeather(code: number): { mode: WeatherMode; label: string } {
  if (code === 0) return { mode: "clear", label: "Clear" };
  if (code === 1) return { mode: "clear", label: "Mostly clear" };
  if (code === 2) return { mode: "cloudy", label: "Partly cloudy" };
  if (code === 3) return { mode: "cloudy", label: "Overcast" };
  if (code === 45 || code === 48) return { mode: "fog", label: "Foggy" };
  if (code >= 51 && code <= 57) return { mode: "drizzle", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { mode: "rain", label: "Rain" };
  if (code >= 95 && code <= 99) return { mode: "storm", label: "Thunderstorm" };
  // Snow and freezing conditions are rendered as dense cloud cover in this
  // Dhaka-specific experience instead of introducing an implausible snow VFX.
  return { mode: "cloudy", label: "Cloudy" };
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function fetchWeather() {
  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", LOCATION.lat.toString());
  url.searchParams.set("longitude", LOCATION.lon.toString());
  url.searchParams.set("current", [
    "temperature_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "rain",
    "showers",
    "weather_code",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
  ].join(","));
  url.searchParams.set("timezone", "Asia/Dhaka");
  url.searchParams.set("forecast_days", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Weather provider responded with ${response.status}`);
    const data = await response.json() as OpenMeteoResponse;
    const current = data.current;
    if (!current?.time || typeof current.weather_code !== "number") {
      throw new Error("Weather provider returned no current conditions");
    }
    const weatherCode = finiteNumber(current.weather_code);
    const description = describeWeather(weatherCode);
    return {
      source: "Open-Meteo",
      fetchedAt: new Date().toISOString(),
      observedAt: current.time,
      ...description,
      weatherCode,
      isDay: current.is_day === 1,
      temperature: finiteNumber(current.temperature_2m),
      apparentTemperature: finiteNumber(current.apparent_temperature),
      precipitation: Math.max(
        finiteNumber(current.precipitation),
        finiteNumber(current.rain) + finiteNumber(current.showers),
      ),
      cloudCover: Math.min(100, Math.max(0, finiteNumber(current.cloud_cover))),
      windSpeed: Math.max(0, finiteNumber(current.wind_speed_10m)),
      windDirection: finiteNumber(current.wind_direction_10m),
      windGusts: Math.max(0, finiteNumber(current.wind_gusts_10m)),
    } satisfies WeatherPayload;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (cachedWeather && Date.now() < cachedUntil) {
    return Response.json(cachedWeather, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  }

  inFlightRequest ??= fetchWeather().finally(() => {
    inFlightRequest = null;
  });

  try {
    cachedWeather = await inFlightRequest;
    cachedUntil = Date.now() + CACHE_TTL_MS;
    return Response.json(cachedWeather, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    if (cachedWeather) return Response.json(cachedWeather);
    return Response.json(
      { error: error instanceof Error ? error.message : "Live weather is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
