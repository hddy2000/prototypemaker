Fly.io deployment

1. Install Fly CLI: https://fly.io/docs/flyctl/install/
2. Login: fly auth login
3. From this server directory, create or rename the app in fly.toml if needed.
4. Deploy: fly deploy
5. After deploy, your WebSocket endpoint will be:
   wss://<your-app-name>.fly.dev

GitHub Actions auto-deploy

1. In GitHub, create a repo secret named `FLY_API_TOKEN`.
2. Generate the token locally with: `fly tokens create deploy -a prototypemaker-colyseus -x 999999h`
3. Paste that token into the repo secret.
4. Push any change under `server/` and GitHub Actions will run `.github/workflows/fly-deploy.yml`.

Client config

1. Put the Fly URL into ../.env.production:
   VITE_SERVER_URL=wss://<your-app-name>.fly.dev
2. Build the client separately where you host the static site.

Notes

- This Fly app only deploys the Colyseus server in server/.
- The Phaser client remains a separate static deployment.
- For local external testing, keep using ngrok and .env.ngrok.
