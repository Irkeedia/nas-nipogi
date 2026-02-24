#!/bin/bash
# ═══════════════════════════════════════════════════════
# NexusNAS — Script de démarrage
# ═══════════════════════════════════════════════════════

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
WHITE='\033[1;37m'
NC='\033[0m'

# Check if venv exists
if [ ! -d "venv" ]; then
    echo -e "${RED}Erreur: Exécutez d'abord ./install.sh${NC}"
    exit 1
fi

source venv/bin/activate

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
PORT=8888

echo -e "${RED}"
echo "╔══════════════════════════════════════════════╗"
echo "║                                              ║"
echo "║          ███╗   ██╗ █████╗ ███████╗          ║"
echo "║          ████╗  ██║██╔══██╗██╔════╝          ║"
echo "║          ██╔██╗ ██║███████║███████╗          ║"
echo "║          ██║╚██╗██║██╔══██║╚════██║          ║"
echo "║          ██║ ╚████║██║  ██║███████║          ║"
echo "║          ╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝          ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${GREEN}NexusNAS démarre...${NC}"
echo ""
echo -e "  Accès local:   ${WHITE}http://localhost:${PORT}${NC}"
echo -e "  Accès réseau:  ${WHITE}http://${LOCAL_IP}:${PORT}${NC}"
echo ""
echo -e "  ${GREEN}Premier lancement ? Créez votre compte admin.${NC}"
echo -e "  Appuyez sur Ctrl+C pour arrêter."
echo ""

uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1
