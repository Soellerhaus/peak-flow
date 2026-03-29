#!/bin/bash
# BRouter Server Installation for Peakflow
# Run as root on Ubuntu 22.04/24.04

set -e
echo "🏔️ Peakflow BRouter Server Setup"
echo "================================="

# 1. Update system
echo "📦 Updating system..."
apt update -y && apt upgrade -y

# 2. Install Java
echo "☕ Installing Java..."
apt install -y default-jre-headless wget unzip

# 3. Create BRouter directory
echo "📁 Creating BRouter directory..."
mkdir -p /opt/brouter/segments4
cd /opt/brouter

# 4. Download BRouter
echo "⬇️ Downloading BRouter..."
wget -q https://brouter.de/brouter/brouter_1_7_0.zip -O brouter.zip
unzip -o brouter.zip
chmod +x standalone/server.sh

# 5. Download Alpine region routing data (segments)
echo "⬇️ Downloading Alpine routing data (~2GB)..."
cd segments4

# Alpine region segments (lat 44-50, lon 4-18)
for lat in 44 45 46 47 48 49; do
  for lon in 0 5 10 15; do
    file="E${lon}_N${lat}.rd5"
    url="https://brouter.de/brouter/segments4/${file}"
    if [ ! -f "$file" ]; then
      echo "  Downloading ${file}..."
      wget -q "$url" -O "$file" 2>/dev/null || echo "  Skip ${file} (not available)"
    fi
  done
done

cd /opt/brouter

# 6. Download routing profiles
echo "⬇️ Downloading routing profiles..."
mkdir -p profiles2
cd profiles2
for profile in hiking-mountain hiking-beta shortest trekking; do
  wget -q "https://brouter.de/brouter/profiles2/${profile}.brf" -O "${profile}.brf" 2>/dev/null || echo "  Skip ${profile}"
done
cd /opt/brouter

# 7. Create startup script
echo "🔧 Creating startup script..."
cat > /opt/brouter/start.sh << 'STARTEOF'
#!/bin/bash
cd /opt/brouter
java -Xmx2g -Xms512m -cp standalone/brouter.jar btools.server.RouteServer segments4 profiles2 customprofiles 17777 1
STARTEOF
chmod +x /opt/brouter/start.sh

# 8. Create systemd service
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/brouter.service << 'SVCEOF'
[Unit]
Description=BRouter Routing Server for Peakflow
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/brouter
ExecStart=/opt/brouter/start.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

# 9. Open firewall port
echo "🔓 Opening port 17777..."
ufw allow 17777/tcp 2>/dev/null || iptables -A INPUT -p tcp --dport 17777 -j ACCEPT 2>/dev/null || true

# 10. Start BRouter
echo "🚀 Starting BRouter..."
systemctl daemon-reload
systemctl enable brouter
systemctl start brouter

# Wait for startup
sleep 5

# 11. Test
echo ""
echo "🧪 Testing BRouter..."
RESULT=$(curl -s "http://localhost:17777/brouter?lonlats=10.15,47.34|10.12,47.32&profile=hiking-mountain&alternativeidx=0&format=geojson" | head -c 100)
if echo "$RESULT" | grep -q "Feature"; then
  echo "✅ BRouter is RUNNING!"
  echo ""
  echo "================================="
  echo "🏔️ Peakflow BRouter Server READY"
  echo "================================="
  echo ""
  echo "Server: http://$(hostname -I | awk '{print $1}'):17777"
  echo "Test:   http://$(hostname -I | awk '{print $1}'):17777/brouter?lonlats=10.15,47.34|10.12,47.32&profile=hiking-mountain&alternativeidx=0&format=geojson"
  echo ""
  echo "Now update routes.js in Peakflow:"
  echo "  const BROUTER_URL = 'http://$(hostname -I | awk '{print $1}'):17777/brouter';"
else
  echo "❌ BRouter failed to start. Check: journalctl -u brouter"
fi
