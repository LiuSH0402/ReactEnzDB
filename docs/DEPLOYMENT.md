# Deployment

## Website configuration

The website uses Next.js. Install dependencies as described in the [README](../README.md), then provide the compatible runtime inputs listed in [Data layout](DATA_LAYOUT.md).

Copy the website `.env.example` to `.env.local`. Set `REACTENZDB_PYTHON` to the Python interpreter and `REACTENZDB_RELEASE_DIR` to the runtime release directory. Evidence, expression and download locations can be configured separately. Keep actual environment files outside version control.

## Docker Compose

The Compose configuration uses this repository's directory layout and standard image names. The default web binding is localhost port 8080.

```bash
cp deploy/.env.example deploy/.env
# Configure the environment and prepare data and writable runtime directories
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

Optional model services use the `tools` profile. Install their upstream code, compatible resources and required permissions, then configure the corresponding tool switches:

```bash
docker compose --profile tools --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

## Mounted files

- `web_release/`: runtime databases and analysis layers.
- `data/downloads/`: download catalog and downloadable files.
- Evidence, expression and host-context files: use the locations defined in the Compose mounts.
- `runtime/`: writable anonymous statistics and queue files; the container user needs write access.

Scientific data mounts are read-only. Optional services remain disabled until their inputs are configured.

The website build, regression tests and local data replay were validated. Compose configuration passed `config --quiet`; building and running every optional model container was outside that validation scope. See [Validation](VALIDATION.md).
