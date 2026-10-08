set -euo pipefail
# Do not enable shell tracing: the database secret must not enter cloud-init logs.
dnf install -y docker jq unzip awscli2
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins /opt/syncguard
curl -fsSL https://github.com/docker/compose/releases/download/v2.38.2/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
aws s3 cp "$SYNCGUARD_SOURCE" /opt/syncguard/source.zip --region "$SYNCGUARD_REGION"
unzip -q /opt/syncguard/source.zip -d /opt/syncguard
SYNCGUARD_SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$SYNCGUARD_SECRET" --region "$SYNCGUARD_REGION" --query SecretString --output text)
SYNCGUARD_USER=$(echo "$SYNCGUARD_SECRET_JSON" | jq -r '.username | @uri')
SYNCGUARD_PASSWORD=$(echo "$SYNCGUARD_SECRET_JSON" | jq -r '.password | @uri')
umask 077
mkdir -p /opt/syncguard/certs
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /opt/syncguard/certs/rds-ca.pem
chmod 755 /opt/syncguard/certs
chmod 644 /opt/syncguard/certs/rds-ca.pem
cat > /opt/syncguard/.env <<EOF
DATABASE_URL=postgresql://${SYNCGUARD_USER}:${SYNCGUARD_PASSWORD}@${SYNCGUARD_DB_HOST}:5432/syncguard
DATABASE_SSL_CA_FILE=/app/certs/rds-ca.pem
REDIS_URL=redis://redis:6379
PM_URL=http://pm:8002
EOF
unset SYNCGUARD_SECRET_JSON SYNCGUARD_PASSWORD
cat > /etc/systemd/system/syncguard.service <<'EOF'
[Unit]
Description=SyncGuard demo services
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/syncguard
ExecStart=/usr/bin/docker compose -f compose.aws.yaml up --build -d
ExecStop=/usr/bin/docker compose -f compose.aws.yaml stop
TimeoutStartSec=1800
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now syncguard
