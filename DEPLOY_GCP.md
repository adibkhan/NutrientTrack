# Deploy NutrientTrack to Google Cloud Run

NutrientTrack builds to static files. The repository's multi-stage `Dockerfile` builds the PWA with Node and serves only `dist/` with Nginx. Nginx listens on the `PORT` environment variable supplied by Cloud Run; the default is 8080. The container does not store diary data. Entries, goals, foods, and weights remain in each visitor's browser.

## Test the image locally

```powershell
docker build -t nutrienttrack:local .
docker run --rm -p 8080:8080 -e PORT=8080 nutrienttrack:local
```

Open `http://localhost:8080/` and check `http://localhost:8080/health`. The latter should return `ok`. (Cloud Run reserves paths ending in `z`, such as `/healthz`, so the health check uses `/health`.) The app remains installable and can cache its shell and catalog after its first successful visit.

## Deploy from this folder

Use a Google Cloud project with billing enabled and permission to deploy Cloud Run services. Replace `PROJECT_ID` and `REGION` with your actual project and chosen region.

```powershell
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
gcloud run deploy nutrienttrack --source . --region REGION --allow-unauthenticated --port 8080
```

`--source .` builds the included Dockerfile in Cloud Build and deploys the resulting image. Cloud Run returns an HTTPS `run.app` address. The app needs HTTPS for PWA installation outside localhost. To use the NutrientTrack domain, configure a custom URL or a load balancer after the service works at its `run.app` address; update DNS only after the HTTPS endpoint is ready.

## Data and release behavior

- The Cloud Run container serves static files and can scale to zero. It is not a database or synchronization service.
- Browser data is tied to the exact origin. Data entered at `localhost`, a `run.app` URL, and a later custom domain are separate. Use the app's JSON export and restore to move records between them. Choose the final domain before inviting users to log data.
- `index.html`, `sw.js`, and the web manifest ask browsers to revalidate. Hashed build assets can be cached long term. The catalog and icons have one-day HTTP caching; the service worker also manages offline copies.
- Publishing a new image does not migrate or erase a visitor's IndexedDB records at the same origin. A user who clears site data or switches browsers still needs a backup.
