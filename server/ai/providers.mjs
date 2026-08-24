import { askGroq } from './groq.mjs'
import { askGemini } from './gemini.mjs'
import { askOllama } from './ollama.mjs'
import { askOpenAI } from './openai.mjs'
import { askAnthropic } from './anthropic.mjs'

export const defaultProviders = Object.freeze({
  groq: askGroq,
  gemini: askGemini,
  ollama: askOllama,
  openai: askOpenAI,
  anthropic: askAnthropic,
})
