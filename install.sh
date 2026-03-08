#!/bin/bash
# ═══════════════════════════════════════════════════════
# NexusNAS — Script d'installation automatique
# ═══════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
WHITE='\033[1;37m'
NC='\033[0m'

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$INSTALL_DIR/venv"

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
echo "║           NexusNAS — Installation             ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# Check Python
echo -e "${WHITE}[1/5]${NC} Vérification de Python..."
if command -v python3 &> /dev/null; then
    PYTHON=$(command -v python3)
    PY_VERSION=$($PYTHON --version 2>&1 | awk '{print $2}')
    echo -e "  ${GREEN}✓${NC} Python $PY_VERSION trouvé"
else
    echo -e "  ${RED}✕${NC} Python 3 non trouvé. Installation requise."
    sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip
    PYTHON=$(command -v python3)
fi

# Check ffmpeg (for video thumbnails)
echo -e "${WHITE}[2/5]${NC} Vérification de ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} ffmpeg trouvé"
else
    echo -e "  ${YELLOW}→${NC} Installation de ffmpeg (miniatures vidéo)..."
    sudo apt-get update && sudo apt-get install -y ffmpeg
    echo -e "  ${GREEN}✓${NC} ffmpeg installé"
fi

# Create venv
echo -e "${WHITE}[3/5]${NC} Création de l'environnement virtuel..."
if [ ! -d "$VENV_DIR" ]; then
    $PYTHON -m venv "$VENV_DIR"
    echo -e "  ${GREEN}✓${NC} Environnement virtuel créé"
else
    echo -e "  ${YELLOW}→${NC} Environnement virtuel existant"
fi

# Install deps
echo -e "${WHITE}[4/5]${NC} Installation des dépendances..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$INSTALL_DIR/requirements.txt" -q
echo -e "  ${GREEN}✓${NC} Dépendances installées"

# Create directories
echo -e "${WHITE}[5/5]${NC} Préparation du stockage..."
mkdir -p "$INSTALL_DIR/storage"
mkdir -p "$INSTALL_DIR/thumbnails"
echo -e "  ${GREEN}✓${NC} Dossiers créés"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗"
echo -e "║  Installation terminée avec succès !          ║"
echo -e "╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Pour démarrer NexusNAS :"
echo -e "  ${WHITE}cd $INSTALL_DIR${NC}"
echo -e "  ${WHITE}./start.sh${NC}"
echo ""
echo -e "Ou manuellement :"
echo -e "  ${WHITE}source venv/bin/activate${NC}"
echo -e "  ${WHITE}uvicorn app.main:app --host 0.0.0.0 --port 8888${NC}"
echo ""
