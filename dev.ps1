# PowerShell wrapper for Windows users
param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    [Parameter(Position=1)]
    [string]$Arg2 = ""
)

$ComposeFile = "infra/docker/docker-compose.yml"
$ProjectName = "frontdesk-ai"
$EnvFile = ".env"

function Write-Info($msg)  { Write-Host "[frontdesk] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[frontdesk] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[frontdesk] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[frontdesk] $msg" -ForegroundColor Red }

if (-not (Test-Path $EnvFile)) {
    Write-Warn ".env not found — copying from .env.example"
    Copy-Item ".env.example" ".env"
}

switch ($Command) {
    "up" {
        $flags = @()
        if ($Arg2 -eq "observability") { $flags += "--profile", "observability" }
        Write-Info "Starting infrastructure stack (profile: $(if ($Arg2 -ne '') { $Arg2 } else { 'default' }))..."
        docker compose -f $ComposeFile -p $ProjectName --env-file $EnvFile @flags up -d --build --remove-orphans
        Write-Ok "Stack is up."
        Write-Ok "  Postgres:       postgresql://frontdesk:frontdesk_secret@localhost:5434/frontdesk"
        Write-Ok "  Redis:          redis://localhost:6379"
        Write-Ok "  Kafka:          localhost:9092"
        Write-Ok "  Elasticsearch:  http://localhost:9200"
        if ($Arg2 -eq "observability") {
            Write-Ok "  Jaeger UI:      http://localhost:16686"
            Write-Ok "  Prometheus:     http://localhost:9090"
            Write-Ok "  Kibana:         http://localhost:5601"
        }
    }
    "down" {
        Write-Info "Stopping infrastructure stack..."
        docker compose -f $ComposeFile -p $ProjectName down
        Write-Ok "Stack stopped."
    }
    "logs" {
        docker compose -f $ComposeFile -p $ProjectName logs -f --tail=100 $Arg2
    }
    "reset" {
        $confirm = Read-Host "This will DESTROY ALL local volumes. Type 'yes' to confirm"
        if ($confirm -eq "yes") {
            Write-Info "Tearing down stack and removing volumes..."
            docker compose -f $ComposeFile -p $ProjectName down -v --remove-orphans
            Write-Ok "Volumes purged."
        } else {
            Write-Info "Aborted."
        }
    }
    "ps" {
        docker compose -f $ComposeFile -p $ProjectName ps
    }
    default {
        Write-Host ""
        Write-Host "  Frontdesk AI — Dev Helper (PowerShell)" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Usage: .\dev.ps1 <command> [options]"
        Write-Host ""
        Write-Host "  Commands:"
        Write-Host "    up [observability]   Start the dev stack"
        Write-Host "    down                 Stop all containers"
        Write-Host "    logs [service]       Tail logs"
        Write-Host "    reset                Destroy volumes (destructive!)"
        Write-Host "    ps                   Show running containers"
        Write-Host ""
    }
}
