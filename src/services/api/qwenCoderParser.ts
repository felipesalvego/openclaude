/**
 * Qwen3-Coder Tool Call Parser & JSON Repair Layer
 * 
 * This module provides robust parsing and repair functionality for Qwen3-Coder:30B
 * model responses, which often produce malformed JSON or non-standard tool call formats.
 * 
 * Features:
 * - Multi-format tool call parser (Anthropic, OpenAI, Qwen-native, text-based)
 * - Advanced JSON repair with bracket matching and context awareness
 * - Temperature normalization layer
 * - Aggressive system prompt injection for coding agent behavior
 * - Real-time streaming JSON repair
 * - Fallback extraction from any text format
 */

import { safeParseJSON } from '../../utils/json.js'
import { logForDebugging } from '../../utils/debug.js'

// ============================================================================
// Configuration for Qwen3-Coder optimization
// ============================================================================

export const QWEN_CODER_CONFIG = {
  /** Force low temperature for deterministic outputs */
  temperature: 0.1,
  /** Top-p for focused sampling */
  top_p: 0.5,
  /** Max tokens for tool calls */
  max_tool_tokens: 4096,
  /** Enable aggressive JSON repair */
  aggressiveRepair: true,
  /** Retry failed parses with different strategies */
  retryStrategies: true,
  /** Enable streaming repair mode */
  streamingRepair: true,
} as const

// ============================================================================
// System Prompt for Coding Agent Behavior
// ============================================================================

export const QWEN_CODER_SYSTEM_PROMPT = `You are an expert coding assistant with deep knowledge of software development best practices.

CRITICAL INSTRUCTIONS:
1. ALWAYS output valid, properly formatted JSON when using tools
2. NEVER output explanations outside of tool calls when a tool is needed
3. ALWAYS close all JSON brackets and quotes properly
4. Use tool calls EXCLUSIVELY for file operations, command execution, and code analysis
5. Think step-by-step but ONLY output the final tool call in valid JSON format

TOOL CALL FORMAT REQUIREMENTS:
- All tool calls MUST be valid JSON objects
- All string values MUST be properly quoted with double quotes
- All brackets MUST be properly closed
- NO markdown formatting around JSON (no \`\`\`json blocks)
- NO explanatory text before or after the JSON

If you need to use multiple tools, output them as separate tool calls in sequence.
NEVER combine multiple tool calls into a single JSON array.

Remember: Invalid JSON will cause the system to fail. Always validate your JSON mentally before outputting it.`

// ============================================================================
// JSON Repair Utilities
// ============================================================================

/**
 * Common JSON repair suffixes for truncated objects
 */
const JSON_REPAIR_SUFFIXES = [
  '}', 
  '"}', 
  ']}', 
  '"]}', 
  '}}', 
  '"}}', 
  ']}}', 
  '"]}}', 
  '\"]}]}', 
  '}]}',
  '}\n}',
  '"\n}',
  '\\n}',
]

/**
 * Count unmatched brackets in a string, tracking string context properly
 */
function countUnmatchedBrackets(json: string): { braces: number; brackets: number; parens: number } {
  let braces = 0   // {}
  let brackets = 0 // []
  let parens = 0   // ()
  let inString = false
  let escape = false

  for (let i = 0; i < json.length; i++) {
    const char = json[i]
    
    if (escape) {
      escape = false
      continue
    }
    
    if (char === '\\') {
      escape = true
      continue
    }
    
    if (char === '"' && !escape) {
      inString = !inString
      continue
    }
    
    if (!inString) {
      if (char === '{') braces++
      else if (char === '}') braces--
      else if (char === '[') brackets++
      else if (char === ']') brackets--
      else if (char === '(') parens++
      else if (char === ')') parens--
    }
  }

  return { 
    braces: Math.max(0, braces), 
    brackets: Math.max(0, brackets),
    parens: Math.max(0, parens)
  }
}

/**
 * Fix common JSON errors in streaming chunks
 */
export function repairStreamingJsonChunk(chunk: string): string {
  if (!chunk) return chunk
  
  // Remove any leading/trailing whitespace that might break parsing
  let repaired = chunk.trim()
  
  // Fix unquoted keys (common Qwen issue)
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
  
  // Replace single quotes with double quotes for string values
  // But be careful not to replace quotes inside strings
  let inStr = false
  let result = ''
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i]
    const prev = i > 0 ? repaired[i - 1] : ''
    
    if (c === "'" && prev !== '\\') {
      // Check if this looks like a string delimiter
      const next = i < repaired.length - 1 ? repaired[i + 1] : ''
      if (!inStr || /[:,{}\[\]]/.test(next)) {
        result += '"'
        inStr = !inStr
        continue
      }
    }
    result += c
  }
  repaired = result
  
  // Remove trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1')
  
  return repaired
}

/**
 * Attempt to repair a possibly truncated or malformed JSON object
 */
export function repairPossiblyTruncatedObjectJson(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Try parsing as-is first
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? trimmed : null
  } catch {
    // Continue to repair strategies
  }

  // Strategy 1: Try common suffixes
  for (const combo of JSON_REPAIR_SUFFIXES) {
    try {
      const repaired = trimmed + combo
      const parsed = JSON.parse(repaired)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return repaired
      }
    } catch {
      // Try next suffix
    }
  }

  // Strategy 2: Count and close unmatched brackets
  const unmatched = countUnmatchedBrackets(trimmed)
  if (unmatched.braces > 0 || unmatched.brackets > 0 || unmatched.parens > 0) {
    let repaired = trimmed
    // Close in reverse order: parens, brackets, braces
    repaired += ')'.repeat(unmatched.parens)
    repaired += ']'.repeat(unmatched.brackets)
    repaired += '}'.repeat(unmatched.braces)
    
    try {
      const parsed = JSON.parse(repaired)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return repaired
      }
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Remove trailing commas (common Qwen issue)
  const noTrailingCommas = trimmed.replace(/,(\s*[}\]])/g, '$1')
  try {
    const parsed = JSON.parse(noTrailingCommas)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return noTrailingCommas
    }
  } catch {
    // Continue
  }

  // Strategy 4: Fix unquoted keys
  const fixedKeys = noTrailingCommas.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
  try {
    const parsed = JSON.parse(fixedKeys)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return fixedKeys
    }
  } catch {
    // Continue
  }

  // Strategy 5: Replace single quotes with double quotes (carefully)
  let singleToDouble = trimmed
  let inStr = false
  let result = ''
  for (let i = 0; i < singleToDouble.length; i++) {
    const c = singleToDouble[i]
    const prev = i > 0 ? singleToDouble[i - 1] : ''
    
    if (c === "'" && prev !== '\\') {
      // Check if this looks like a string delimiter
      if (!inStr || (i < singleToDouble.length - 1 && /[:,{}\[\]]/.test(singleToDouble[i + 1] || ''))) {
        result += '"'
        inStr = !inStr
        continue
      }
    }
    result += c
  }
  
  try {
    const parsed = JSON.parse(result)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return result
    }
  } catch {
    // Final fallback
  }

  return null
}

/**
 * Extract JSON from text that may contain markdown or explanatory text
 * Enhanced with multiple extraction strategies for Qwen edge cases
 */
export function extractJsonFromText(text: string): string | null {
  if (!text) return null

  // Strategy 1: Try to find JSON block in markdown
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (markdownMatch) {
    return markdownMatch[1].trim()
  }

  // Strategy 2: Try to find JSON object pattern
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return text.substring(jsonStart, jsonEnd + 1)
  }

  // Strategy 3: Look for tool_call or function_call patterns
  const toolCallMatch = text.match(/(tool_call|function_call)\s*[:=]\s*(\{[\s\S]*\})/i)
  if (toolCallMatch && toolCallMatch[2]) {
    return toolCallMatch[2].trim()
  }

  // Strategy 4: Look for name+input pattern without proper JSON wrapper
  const nameInputMatch = text.match(/name\s*[:=]\s*["']([^"']+)["'][\s\S]*?(?:input|arguments|parameters)\s*[:=]\s*(\{[\s\S]*\})/i)
  if (nameInputMatch && nameInputMatch[2]) {
    return `{ "name": "${nameInputMatch[1]}", "input": ${nameInputMatch[2]} }`
  }

  // Strategy 5: Extract any balanced braces structure
  let braceCount = 0
  let startIdx = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (braceCount === 0) startIdx = i
      braceCount++
    } else if (text[i] === '}') {
      braceCount--
      if (braceCount === 0 && startIdx !== -1) {
        return text.substring(startIdx, i + 1)
      }
    }
  }

  return null
}

/**
 * Aggressive JSON extraction - tries to salvage ANY JSON-like content
 */
export function extractJsonAggressive(text: string): string | null {
  if (!text) return null
  
  // First try standard extraction
  let result = extractJsonFromText(text)
  if (result) return result
  
  // If that fails, try to construct something usable
  const trimmed = text.trim()
  
  // Check if it starts with { but doesn't end properly
  if (trimmed.startsWith('{')) {
    // Count brackets and close them
    const unmatched = countUnmatchedBrackets(trimmed)
    let repaired = trimmed
    repaired += '}'.repeat(unmatched.braces)
    repaired += ']'.repeat(unmatched.brackets)
    return repaired
  }
  
  // Check if there's a partial JSON anywhere
  const jsonLikeMatch = trimmed.match(/\{[^{}]*\}/g)
  if (jsonLikeMatch && jsonLikeMatch.length > 0) {
    // Return the largest match as it's most likely complete
    return jsonLikeMatch.reduce((a, b) => a.length > b.length ? a : b)
  }
  
  return null
}

// ============================================================================
// Tool Call Format Detection & Parsing
// ============================================================================

export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  rawInput?: string
  format: 'anthropic' | 'openai' | 'qwen' | 'text'
}

/**
 * Detect and parse tool calls from various formats
 */
export function parseToolCalls(content: unknown): ParsedToolCall[] {
  const results: ParsedToolCall[] = []

  if (!content) return results

  // Handle array of content blocks
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object') {
        const parsed = parseSingleToolCall(block)
        if (parsed) results.push(parsed)
      }
    }
    return results
  }

  // Handle string content (may contain embedded tool calls)
  if (typeof content === 'string') {
    return parseToolCallsFromString(content)
  }

  // Handle single object
  if (typeof content === 'object') {
    const parsed = parseSingleToolCall(content as Record<string, unknown>)
    if (parsed) results.push(parsed)
  }

  return results
}

/**
 * Parse a single tool call from an object
 */
function parseSingleToolCall(block: Record<string, unknown>): ParsedToolCall | null {
  // Anthropic format: { type: 'tool_use', id, name, input }
  if (block.type === 'tool_use' && block.id && block.name) {
    return {
      id: String(block.id),
      name: String(block.name),
      input: typeof block.input === 'object' && block.input !== null 
        ? block.input as Record<string, unknown>
        : safeParseJSON(String(block.input)) || {},
      rawInput: typeof block.input === 'string' ? block.input as string : undefined,
      format: 'anthropic',
    }
  }

  // OpenAI format: { role: 'assistant', tool_calls: [...] }
  if (block.tool_calls && Array.isArray(block.tool_calls)) {
    const calls: ParsedToolCall[] = []
    for (const tc of block.tool_calls) {
      if (tc && typeof tc === 'object' && 'function' in tc) {
        const func = (tc as any).function
        calls.push({
          id: String(tc.id || `call_${Date.now()}`),
          name: String(func?.name || 'unknown'),
          input: safeParseJSON(String(func?.arguments || '{}')) || {},
          rawInput: String(func?.arguments || ''),
          format: 'openai',
        })
      }
    }
    // Return first call, rest handled separately
    return calls[0] || null
  }

  // Qwen native format variations
  if (block.function_call || block.tool_call) {
    const fc = block.function_call || block.tool_call
    if (fc && typeof fc === 'object') {
      return {
        id: String(fc.id || `call_${Date.now()}`),
        name: String(fc.name || 'unknown'),
        input: safeParseJSON(String(fc.arguments || fc.input || '{}')) || {},
        rawInput: String(fc.arguments || fc.input || ''),
        format: 'qwen',
      }
    }
  }

  return null
}

/**
 * Parse tool calls from raw text (Qwen sometimes outputs text-based tool calls)
 * Enhanced with aggressive extraction and multiple fallback strategies
 */
function parseToolCallsFromString(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = []

  // Strategy 1: Try standard JSON extraction
  let jsonStr = extractJsonFromText(text)
  
  // Strategy 2: If that fails, try aggressive extraction
  if (!jsonStr) {
    jsonStr = extractJsonAggressive(text)
    if (jsonStr) {
      logForDebugging('[QwenCoder] Used aggressive JSON extraction', { textPreview: text.substring(0, 50) })
    }
  }
  
  if (!jsonStr) return results

  // Try to parse as single tool call with repair
  let repaired = repairPossiblyTruncatedObjectJson(jsonStr)
  
  // Additional fallback: try parsing without repair first
  if (!repaired) {
    repaired = jsonStr
  }
  
  const parsed = safeParseJSON(repaired)
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    
    // Check if it's a direct tool call
    if (obj.name && (obj.input || obj.arguments || obj.parameters)) {
      results.push({
        id: String(obj.id || `call_${Date.now()}_${results.length}`),
        name: String(obj.name),
        input: (obj.input || obj.arguments || obj.parameters) as Record<string, unknown>,
        rawInput: jsonStr,
        format: 'text',
      })
      return results
    }
    // Check if it's wrapped in a tool_use structure
    else if (obj.type === 'tool_use' || obj.tool_use) {
      const toolObj = obj.type === 'tool_use' ? obj : (obj.tool_use as Record<string, unknown>)
      results.push({
        id: String(toolObj.id || `call_${Date.now()}_${results.length}`),
        name: String(toolObj.name || 'unknown'),
        input: (toolObj.input || toolObj.arguments || {}) as Record<string, unknown>,
        rawInput: jsonStr,
        format: 'text',
      })
      return results
    }
    // Check for OpenAI-style tool_calls array
    else if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
      for (const tc of obj.tool_calls) {
        if (tc && typeof tc === 'object') {
          const func = (tc as any).function
          if (func) {
            results.push({
              id: String(tc.id || `call_${Date.now()}_${results.length}`),
              name: String(func.name || 'unknown'),
              input: safeParseJSON(String(func.arguments || '{}')) || {},
              rawInput: String(func.arguments || ''),
              format: 'text',
            })
          }
        }
      }
      if (results.length > 0) return results
    }
  }
  
  // Last resort: try to construct a minimal tool call from partial data
  const nameMatch = text.match(/["']?name["']?\s*[:=]\s*["']([^"']+)["']/i)
  if (nameMatch && nameMatch[1]) {
    const inputMatch = text.match(/\{[^{}]*\}/g)
    const inputObj = inputMatch && inputMatch.length > 0 
      ? safeParseJSON(inputMatch[inputMatch.length - 1]) || {}
      : {}
    
    results.push({
      id: `call_${Date.now()}_fallback`,
      name: nameMatch[1],
      input: inputObj,
      rawInput: jsonStr || text,
      format: 'text',
    })
  }

  return results
}

// ============================================================================
// Request Parameter Normalization
// ============================================================================

/**
 * Normalize request parameters for Qwen3-Coder compatibility
 */
export function normalizeQwenRequestParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...params }

  // Force low temperature for deterministic outputs
  if (normalized.temperature === undefined || typeof normalized.temperature !== 'number') {
    normalized.temperature = QWEN_CODER_CONFIG.temperature
  } else if (normalized.temperature > 0.3) {
    logForDebugging(`[QwenCoder] Reducing temperature from ${normalized.temperature} to ${QWEN_CODER_CONFIG.temperature}`, { level: 'warn' })
    normalized.temperature = QWEN_CODER_CONFIG.temperature
  }

  // Set top_p for focused sampling
  if (normalized.top_p === undefined) {
    normalized.top_p = QWEN_CODER_CONFIG.top_p
  }

  // Ensure presence_penalty and frequency_penalty are reasonable
  if (normalized.presence_penalty === undefined) {
    normalized.presence_penalty = 0
  }
  if (normalized.frequency_penalty === undefined) {
    normalized.frequency_penalty = 0
  }

  return normalized
}

/**
 * Inject Qwen-specific system prompt enhancements
 */
export function enhanceSystemPrompt(existingPrompt: string | undefined): string {
  const basePrompt = existingPrompt || ''
  
  // Check if already contains our marker
  if (basePrompt.includes('[QWEN_CODER_AGENT]')) {
    return basePrompt
  }

  return `${QWEN_CODER_SYSTEM_PROMPT}\n\n---\n\n${basePrompt}`.trim()
}

// ============================================================================
// Response Validation
// ============================================================================

/**
 * Validate that a tool call has all required fields
 */
export function validateToolCall(call: ParsedToolCall): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!call.id || call.id.trim() === '') {
    errors.push('Missing or empty tool call ID')
  }

  if (!call.name || call.name.trim() === '') {
    errors.push('Missing or empty tool name')
  }

  if (call.input === undefined || call.input === null) {
    errors.push('Missing tool input')
  } else if (typeof call.input !== 'object') {
    errors.push('Tool input must be an object')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate a unique tool call ID
 */
export function generateToolCallId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
}
