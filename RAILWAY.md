# Railway deployment and persistent sessions

    Railway launches the multi-user service through web.js. The HTTP server and WhatsApp sockets run in the same process; start:bot (index.js) is a legacy single-session entry point and is not the Railway start command.

    ## Preserve linked WhatsApp sessions across deployments

    1. In Railway, attach one Volume to this service and set its mount path to /app/sessions.
    2. Add the service variable SESSION_DIR=/app/sessions. Do not place credentials in the repository or in a public variable.
    3. Keep this service at one replica. Railway Volumes are not compatible with replicas, and the session registry/connection locks are process-local.
    4. Deploy and inspect /health: total is the number of known sessions and connected is the number whose WhatsApp socket is currently open. A web health response alone does not mean WhatsApp is connected.

    A deploy necessarily restarts the process and briefly closes its WebSocket connections. With the volume mounted, credentials and the session registry survive; web.js restores the sessions after startup. No code can keep a socket open while its process is being replaced.

    ## Channel alerts

    Channel following is per-account and opt-in. From each linked WhatsApp account, send .channelalert followed by the official WhatsApp channel invite link. The command follows that channel and requests Baileys live updates. The live-update subscription is re-established after a socket reconnect. Use .channelalert status or .channelalert off to inspect or disable alerts for that account.

    The application does not generate reactions through a pool of linked accounts. Baileys exposes a newsletter reaction method, but automated multi-account reactions would artificially amplify channel engagement; this project keeps notifications private and per-account instead.

    ## Build

    The deployment build uses the checked-in pnpm-lock.yaml in frozen mode, the application declares Node 20, and the start command remains node web.js (or pnpm start on Render).
    