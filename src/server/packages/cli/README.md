# @amodel/cli

CLI tool for running [Amodel](https://www.getamodel.com) - an open-source AI email assistant.

## Installation

### Homebrew (macOS/Linux)

```bash
brew install amodel/amodel/amodel
```

### Manual Installation

Download the binary for your platform from [releases](https://github.com/elie222/amodel/releases) and add to your PATH.

## Quick Start

```bash
# Configure Amodel (interactive)
amodel setup

# Start Amodel
amodel start

# Open http://localhost:3000
```

## Commands

### `amodel setup`

Interactive setup wizard that:
- Configures OAuth providers (Google/Microsoft)
- Sets up your LLM provider and API key
- Configures ports (to avoid conflicts)
- Generates all required secrets

Configuration is stored in `~/.amodel/`

### `amodel start`

Pulls the latest Docker image and starts all containers:
- PostgreSQL database
- Redis cache
- Amodel web app
- Cron job for email sync

```bash
amodel start           # Start in background
amodel start --no-detach  # Start in foreground
```

### `amodel stop`

Stops all running containers.

```bash
amodel stop
```

### `amodel logs`

View container logs.

```bash
amodel logs            # Show last 100 lines
amodel logs -f         # Follow logs
amodel logs -n 500     # Show last 500 lines
```

### `amodel status`

Show status of running containers.

### `amodel update`

Pull the latest Amodel image and optionally restart.

```bash
amodel update
```

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- OAuth credentials from Google and/or Microsoft
- An LLM API key (Google or OpenAI)

## Configuration

All configuration is stored in `~/.amodel/`:
- `.env` - Environment variables
- `docker-compose.yml` - Docker Compose configuration

To reconfigure, run `amodel setup` again.

## License

See [LICENSE](../../LICENSE) in the repository root.
