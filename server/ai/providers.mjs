import { askOpenAI } from './openai.mjs'
import { askAnthropic } from './anthropic.mjs'
import { askGemini } from './gemini.mjs'
import { askOllama } from './ollama.mjs'

export const defaultProviders = Object.freeze({
  openai: askOpenAI,
  anthropic: askAnthropic,
  gemini: askGemini,
  ollama: askOllama,
})
