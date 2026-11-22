#!/usr/bin/env bash
# Instala o Pacotinho Já numa máquina Debian/Ubuntu (ex.: Google Cloud e2-micro).
# Uso (dentro da pasta do projecto):   sudo bash deploy/install.sh
# Podes correr outra vez sem problema: só actualiza o que for preciso.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Corre com sudo:  sudo bash deploy/install.sh"; exit 1; fi
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
ENV_FILE=/etc/pacotinho.env
say() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }

say "1/7  Memória extra (swap de 2 GB), para a máquina pequena não ficar sem memória"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "2/7  Programas base (Node.js 22, git, Caddy para o https)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "Node $(node -v), Caddy $(caddy version | cut -d' ' -f1)"

say "3/7  Configuração (fica guardada em $ENV_FILE, só o administrador consegue ler)"
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
ask() { # ask VAR "pergunta" [secreto]
  local cur; cur="$(get "$1")"
  if [ -n "$cur" ]; then read -rp "$2 [Enter mantém o actual]: " ${3:+-s} val; else read -rp "$2: " ${3:+-s} val; fi
  [ -n "${3:-}" ] && echo
  printf -v "$1" '%s' "${val:-$cur}"
}
ask DUCKDNS_DOMAIN "Subdomínio DuckDNS (só o nome, ex: pacotinhoja)"
ask DUCKDNS_TOKEN  "Token do DuckDNS" s
ask ADMIN_PASSWORD "Palavra-passe do painel (forte!)" s
ask DATABASE_URL   "Ligação do Supabase (Session pooler, começa por postgresql://)" s
ask NVIDIA_API_KEY "Chave da NVIDIA para a IA (Enter para deixar sem IA)" s
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN%.duckdns.org}"
if [ -z "$DUCKDNS_DOMAIN" ] || [ -z "$ADMIN_PASSWORD" ] || [ -z "$DATABASE_URL" ]; then
  echo "❌ O subdomínio, a palavra-passe e a ligação do Supabase são obrigatórios."; exit 1
fi
SESSION_SECRET="$(get SESSION_SECRET)"; SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
umask 077
cat > "$ENV_FILE" <<CONF
PORT=3000
HTTPS=1
NODE_ENV=production
DUCKDNS_DOMAIN=$DUCKDNS_DOMAIN
DUCKDNS_TOKEN=$DUCKDNS_TOKEN
ADMIN_PASSWORD=$ADMIN_PASSWORD
DATABASE_URL=$DATABASE_URL
NVIDIA_API_KEY=$NVIDIA_API_KEY
SESSION_SECRET=$SESSION_SECRET
CONF
chmod 600 "$ENV_FILE"; umask 022

say "4/7  Endereço grátis: $DUCKDNS_DOMAIN.duckdns.org (actualizado a cada 5 minutos)"
cat > /usr/local/bin/pacotinho-duckdns <<'DD'
#!/bin/sh
. /etc/pacotinho.env
curl -fsS "https://www.duckdns.org/update?domains=$DUCKDNS_DOMAIN&token=$DUCKDNS_TOKEN&ip=" -o /dev/null
DD
chmod 700 /usr/local/bin/pacotinho-duckdns
echo "*/5 * * * * root /usr/local/bin/pacotinho-duckdns" > /etc/cron.d/pacotinho-duckdns
if ! /usr/local/bin/pacotinho-duckdns; then echo "⚠️  O DuckDNS recusou. Confirma o subdomínio e o token."; fi

say "5/7  A instalar o Pacotinho Já em $APP_DIR"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev --no-audit --no-fund --loglevel=error

say "6/7  Serviço que arranca sozinho e se reinicia se cair"
cat > /etc/systemd/system/pacotinho.service <<SVC
[Unit]
Description=Pacotinho Ja (bot de WhatsApp + painel)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5
MemoryMax=700M

[Install]
WantedBy=multi-user.target
SVC
systemctl daemon-reload
systemctl enable --now pacotinho >/dev/null
systemctl restart pacotinho

say "7/7  https automático com o Caddy"
cat > /etc/caddy/Caddyfile <<CADDY
$DUCKDNS_DOMAIN.duckdns.org {
  encode gzip
  reverse_proxy localhost:3000
}
CADDY
systemctl reload caddy || systemctl restart caddy

sleep 4
if curl -fsS localhost:3000/api/health >/dev/null; then
  printf "\n\033[1;32m✅ Pronto!\033[0m\n"
  echo "   Painel:  https://$DUCKDNS_DOMAIN.duckdns.org/admin"
  echo "   Site:    https://$DUCKDNS_DOMAIN.duckdns.org"
  echo "   (o cadeado https pode demorar 1 a 2 minutos a aparecer da primeira vez)"
  echo
  echo "   Ver o que o bot está a fazer:   sudo journalctl -u pacotinho -f"
  echo "   Actualizar depois:              cd $APP_DIR && git pull && sudo bash deploy/update.sh"
else
  echo "❌ O bot não arrancou. Últimas linhas do registo:"
  journalctl -u pacotinho -n 30 --no-pager
  exit 1
fi
