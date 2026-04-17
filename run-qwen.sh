#!/bin/bash

echo "🚀 OpenClaude com Qwen3-Coder:30B - Script de Inicialização Rápida"
echo ""

# Verificar se bun está instalado
if ! command -v bun &> /dev/null; then
    echo "❌ Bun não encontrado. Instalando..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Verificar se ollama está instalado
if ! command -v ollama &> /dev/null; then
    echo "❌ Ollama não encontrado. Instalando..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Verificar se o servidor ollama está rodando
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "🔄 Iniciando Ollama server..."
    ollama serve &
    sleep 3
fi

# Verificar se o modelo está disponível
echo "📦 Verificando modelo Qwen3-Coder:30B..."
if ! ollama list | grep -q "qwen3-coder"; then
    echo "⬇️  Baixando modelo qwen3-coder:30b (isso pode demorar)..."
    ollama pull qwen3-coder:30b
fi

# Configurar ambiente
echo "⚙️  Configurando ambiente..."
cat > .env << 'ENVFILE'
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen3-coder:30b
ENVFILE

# Instalar dependências
echo "📦 Instalando dependências..."
bun install

# Build
echo "🔨 Fazendo build..."
bun run build

echo ""
echo "✅ Tudo pronto!"
echo ""
echo "Para rodar, execute:"
echo "  bun run dev"
echo ""
echo "Ou diretamente:"
echo "  node bin/openclaude"
echo ""
echo "📝 Teste com: 'Crie um arquivo teste.txt com Hello World'"
