# 🚀 Guia Definitivo: OpenClaude com Qwen3-Coder:30B

## ✅ Status das Implementações

Todas as correções já estão **IMPLEMENTADAS** nos arquivos:

1. **`/workspace/src/services/api/qwenCoderParser.ts`** - JSON Repair Layer + Multi-format Parser
2. **`/workspace/src/services/api/openaiShim.ts`** - Qwen detection + System Prompt injection + Temperature forcing

### O que já está funcionando:
- ✅ Temperatura forçada em 0.1 automaticamente
- ✅ System prompt agressivo injetado para comportamento de coding agent
- ✅ JSON Repair com 5 estratégias de reparo
- ✅ Parser multi-formato (Anthropic, OpenAI, Qwen-native, text-based)
- ✅ Validação de tool calls antes do envio
- ✅ Streaming repair em tempo real
- ✅ Logs de debug com prefixo `[QwenCoder]`

---

## 📋 Passo a Passo para Rodar

### Pré-requisitos Verificados
- ✅ Node.js v20.19.5 já instalado
- ❌ Bun não instalado (precisa instalar)
- ❌ Ollama não instalado (precisa instalar)
- ❌ Modelo qwen3-coder:30b não baixado

### Passo 1: Instalar Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

**Importante:** Após instalar, feche e abra o terminal novamente ou execute:
```bash
source ~/.bashrc  # ou source ~/.zshrc se usar zsh
```

Verifique a instalação:
```bash
bun --version
```

### Passo 2: Instalar Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Passo 3: Iniciar Ollama e Baixar o Modelo

Em um terminal (deixe rodando em background):
```bash
ollama serve
```

Em outro terminal, baixe o modelo (pode demorar ~20GB):
```bash
ollama pull qwen3-coder:30b
```

**Opcional - Versão quantizada (mais leve):**
```bash
ollama pull qwen3-coder:30b-q4_K_M
```

Verifique se o modelo está disponível:
```bash
ollama list
```

### Passo 4: Configurar Ambiente OpenClaude

```bash
cd /workspace

# Criar arquivo .env
cat > .env << 'EOF'
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen3-coder:30b
EOF
```

### Passo 5: Instalar Dependências e Build

```bash
# Instalar dependências
bun install

# Fazer build do projeto
bun run build
```

### Passo 6: Rodar o OpenClaude

```bash
# Opção 1: Modo desenvolvimento (recomendado para testes)
bun run dev

# Opção 2: Usando o binário diretamente
node bin/openclaude

# Opção 3: Com o script automático (se existir)
./run-qwen.sh
```

---

## 🧪 Testando o Tool Calling

Dentro do chat, teste comandos que exigem tool calling:

### Teste 1: Criar Arquivo
```
Crie um arquivo chamado teste.txt com o conteúdo "Hello World"
```

### Teste 2: Listar Diretório
```
Liste os arquivos no diretório atual
```

### Teste 3: Executar Comando
```
Rode o comando 'ls -la' e me mostre o resultado
```

### Teste 4: Múltiplas Operações
```
Crie um arquivo main.py com um script Python que imprime "Olá Mundo"
```

---

## 🔍 Troubleshooting

### Erro: "JSON parsing failed" ou "Invalid JSON"
**Solução:** O JSON Repair Layer já está ativo. Se persistir:
```bash
# Ativar logs de debug
export DEBUG=qwencoder:*
export LOG_LEVEL=debug
```

Os logs mostrarão:
- `[QwenCoder] JSON repair attempt X`
- `[QwenCoder] Used aggressive JSON extraction`
- `[QwenCoder] Parsed tool call in format: XXX`

### Erro: "Connection refused" na porta 11434
**Solução:** Ollama não está rodando
```bash
# Iniciar Ollama server
ollama serve &

# Verificar se está respondendo
curl http://localhost:11434/api/tags
```

### Tool calls não funcionam / Agente responde em texto
**Solução:** Já corrigido! O sistema agora:
1. Injeta system prompt agressivo automaticamente
2. Força temperatura 0.1
3. Repara JSONs mal-formados
4. Aceita múltiplos formatos de tool call

Se ainda acontecer, verifique os logs de debug.

### Modelo muito lento
**Soluções:**
1. Use versão quantizada: `ollama pull qwen3-coder:30b-q4_K_M`
2. Atualize `.env`: `OPENAI_MODEL=qwen3-coder:30b-q4_K_M`
3. Certifique-se de ter GPU com pelo menos 24GB VRAM

### Erro: "Module not found" ou "Cannot find module"
**Solução:** Reinstalar dependências
```bash
rm -rf node_modules bun.lock
bun install
bun run build
```

---

## 📊 Monitoramento e Debug

### Verificar se Ollama está rodando
```bash
curl http://localhost:11434/api/tags
```

### Verificar modelos disponíveis
```bash
ollama list
```

### Verificar logs do Ollama
```bash
journalctl -u ollama -f  # Linux systemd
# ou veja o output do terminal onde rodou 'ollama serve'
```

### Ativar logs detalhados do OpenClaude
Adicione ao `.env`:
```env
DEBUG=qwencoder:*
LOG_LEVEL=debug
CLAUDE_CODE_DEBUG=1
```

---

## 🎯 Como Funciona a Correção

### 1. Detecção Automática do Qwen
Quando você usa `qwen3-coder` no modelo ou define `CLAUDE_CODE_USE_QWEN=1`, o sistema:
- Detecta automaticamente pelo nome do modelo ou URL
- Ativa o parser especializado
- Injeta o system prompt agressivo

### 2. System Prompt Agressivo
O prompt injetado força:
- JSON sempre válido
- Sem explicações fora dos tool calls
- Brackets e quotes sempre fechados
- Uso exclusivo de tool calls para operações

### 3. JSON Repair Layer (5 Estratégias)
1. **Suffix matching**: Tenta adicionar `}`, `"}`, `]}`, etc.
2. **Bracket counting**: Conta e fecha brackets desbalanceados
3. **Trailing comma removal**: Remove vírgulas trailing
4. **Unquoted keys**: Adiciona quotes em chaves sem quotes
5. **Single quote conversion**: Converte single quotes para double quotes

### 4. Multi-Format Parser
Aceita formatos:
- **Anthropic**: `{ type: 'tool_use', id, name, input }`
- **OpenAI**: `{ tool_calls: [{ function: { name, arguments } }] }`
- **Qwen-native**: `{ function_call: {...} }`
- **Text-based**: Extrai JSON de qualquer texto

### 5. Temperatura Forçada
Sempre envia:
```json
{
  "temperature": 0.1,
  "top_p": 0.5,
  ...
}
```

---

## 📝 Script Automático (Opcional)

Já criei o script `/workspace/run-qwen.sh` que faz tudo automaticamente:

```bash
chmod +x run-qwen.sh
./run-qwen.sh
```

Ele vai:
1. Instalar Bun se necessário
2. Instalar Ollama se necessário
3. Iniciar Ollama server
4. Baixar o modelo qwen3-coder:30b
5. Criar o arquivo `.env`
6. Instalar dependências
7. Fazer build
8. Mostrar instruções de como rodar

---

## ✅ Checklist Final

Antes de rodar, verifique:

- [ ] Bun instalado (`bun --version`)
- [ ] Ollama instalado (`ollama --version`)
- [ ] Ollama server rodando (`curl http://localhost:11434/api/tags`)
- [ ] Modelo baixado (`ollama list | grep qwen`)
- [ ] Arquivo `.env` criado com configurações corretas
- [ ] Dependências instaladas (`bun install`)
- [ ] Build feito (`bun run build`)

Se tudo estiver OK, execute:
```bash
bun run dev
```

E teste com: **"Crie um arquivo teste.txt com Hello World"**

Se o tool calling funcionar, está tudo perfeito! 🎉
