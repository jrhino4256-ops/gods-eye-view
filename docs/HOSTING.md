# Hosting God's Eye View as a public website

This repository deploys to [Render](https://render.com) as a Docker web
service. The container builds the production bundle and serves it with
`vite preview`, which also runs the provider proxies under `server/providers/`.

## Deploy

1. Sign in to Render with GitHub.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml`.
3. Click **Apply**. The first build takes a few minutes.
4. Open `https://<service-name>.onrender.com`.

Pushes to the default branch redeploy automatically.

## Keyless by default

The hosted site sets no API keys, so it uses only the free feeds (OpenSky and
adsb.lol flights, CelesTrak satellites, USGS earthquakes, NOAA weather, public
cameras, transit, launches and the others marked 🟢 in the README). Nobody can
spend money through it:

- The in-app key panel (`/api/setup/*`) only exists on the dev server and only
  answers loopback requests, so it is absent here.
- The cost-bearing routes (OpenAI voice, Google places, Mapillary) refuse any
  request that arrives through a reverse proxy, which every request on Render
  does.

If you add keys as Render environment variables anyway, every visitor uses
them. Read [SECURITY.md](../SECURITY.md) first and set provider billing caps.

## Custom domain

Add the domain in Render, then list it in the `GEV_ALLOWED_HOSTS` environment
variable (comma-separated). The server refuses any Host header it was not
told about; the `*.onrender.com` name is allowed automatically.

## Free plan notes

- The free instance sleeps after 15 idle minutes; the next visit wakes it in
  about a minute.
- On-disk caches live in the container and reset on each deploy or restart.
- Idle memory is about 225 MB of the 512 MB allowance.

## Run the same image locally

```sh
docker build -t gods-eye-view .
docker run -p 10000:10000 gods-eye-view
```

Then open http://localhost:10000.
