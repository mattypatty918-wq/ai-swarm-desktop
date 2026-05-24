import { BrowserWindow } from 'electron';
import log from 'electron-log';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

interface Agent {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: 'idle' | 'working' | 'error';
  currentTask?: string;
  lastUsed?: Date;
  totalRequests: number;
  successRate: number;
}

interface Provider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio' | 'custom' | 'cloudflare' | 'replicate' | 'fal' | 'nvidia';
  baseUrl: string;
  apiKey?: string;
  models: string[];
  enabled: boolean;
  priority: number;
  credits?: number;
  lastLatency?: number;
  successCount: number;
  errorCount: number;
}

interface TaskResult {
  success: boolean;
  result?: string;
  error?: string;
  agentId: string;
  provider: string;
  model: string;
  latencyMs: number;
  timestamp: Date;
}

interface HistoryEntry {
  id: string;
  timestamp: Date;
  task: string;
  strategy: string;
  results: TaskResult[];
  totalAgents: number;
  successCount: number;
  avgLatency: number;
}

export class AISwarmController {
  private window: BrowserWindow;
  private providers: Map<string, Provider> = new Map();
  private agents: Map<string, Agent> = new Map();
  private history: HistoryEntry[] = [];
  private maxHistorySize = 50;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.initializeDefaultProviders();
    this.initializeAgents();
  }

  private loadApiKeysFromConfig(): Record<string, string> {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.apiKeys || {};
      }
    } catch (e) { /* ignore */ }
    return {};
  }

  private initializeDefaultProviders() {
    const savedKeys = this.loadApiKeysFromConfig();
    // Helper to resolve API key: saved key takes precedence, then env var fallback
    const key = (envName: string) => savedKeys[envName] || process.env[envName] || '';
    const defaultProviders: Provider[] = [
      // FREE TIER - Fastest
      { id: 'groq-free', name: 'Groq ⚡', type: 'custom', baseUrl: 'https://api.groq.com/openai/v1', apiKey: key('GROQ_API_KEY'), models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'cerebras-free', name: 'Cerebras 🚀', type: 'custom', baseUrl: 'https://api.cerebras.ai/v1', apiKey: key('CEREBRAS_API_KEY'), models: ['llama-3.3-70b', 'qwen-2.5-72b-instruct', 'mistral-nemo-12b'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'lepton-free', name: 'Lepton AI ✨', type: 'custom', baseUrl: 'https://llama2.lepton.ai/api/v1', apiKey: key('LEPTON_API_KEY'), models: ['llama-2-7b', 'llama-2-13b', 'llama-2-70b'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'grok-free', name: 'Grok 🧠', type: 'custom', baseUrl: 'https://api.x.ai/v1', apiKey: key('GROK_API_KEY') || key('XAI_API_KEY') || 'YOUR_XAI_API_KEY', models: ['grok-2', 'grok-2-mini', 'grok-beta'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      
      // FREE TIER - Standard
      { id: 'deepseek-free', name: 'Deepseek 💰', type: 'custom', baseUrl: 'https://api.deepseek.com/v1', apiKey: key('DEEPSEEK_API_KEY'), models: ['deepseek-chat', 'deepseek-coder', 'deepseek-math'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'perplexity-free', name: 'Perplexity 🔍', type: 'custom', baseUrl: 'https://api.perplexity.ai', apiKey: key('PERPLEXITY_API_KEY'), models: ['sonar', 'sonar-pro', 'sonar-reasoning'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'together-free', name: 'Together.ai 🌐', type: 'custom', baseUrl: 'https://api.together.xyz/v1', apiKey: key('TOGETHER_API_KEY'), models: ['meta-llama/Llama-3-70b-chat', 'mistralai/Mixtral-8x7B-Instruct-v0.1'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'openrouter-free', name: 'OpenRouter 🆓', type: 'custom', baseUrl: 'https://openrouter.ai/api/v1', apiKey: key('OPENROUTER_API_KEY'), models: ['google/gemini-2.0-flash', 'anthropic/claude-3-haiku', 'meta-llama/llama-3.1-8b-instant'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      
      // CLOUD PROVIDERS - Free Tiers
      { id: 'google-free', name: 'Google Gemini 🌟', type: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: key('GOOGLE_API_KEY'), models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'anthropic-free', name: 'Anthropic Claude 🤖', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: key('ANTHROPIC_API_KEY'), models: ['claude-3-5-haiku-20241107', 'claude-3-haiku-20240307'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'cloudflare-ai', name: 'Cloudflare Workers AI ☁️', type: 'cloudflare', baseUrl: key('CF_ACCOUNT_ID') ? `https://api.cloudflare.com/client/v4/accounts/${key('CF_ACCOUNT_ID')}/ai/run` : 'https://api.cloudflare.com/client/v4/accounts/REPLACE_ME/ai/run', apiKey: key('CF_API_KEY'), models: ['@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-3-8b-instruct'], enabled: true, priority: 1, credits: 0, successCount: 0, errorCount: 0 },
      
      // LOCAL - Free Forever
      { id: 'ollama-local', name: 'Ollama (Local) 🏠', type: 'ollama', baseUrl: 'http://localhost:11434', models: ['llama3.2', 'llama3.2:70b', 'mistral', 'mixtral', 'codellama', 'phi3', 'gemma2'], enabled: true, priority: 3, credits: 999999, successCount: 0, errorCount: 0 },
      { id: 'lmstudio-local', name: 'LM Studio (Local) 💾', type: 'lmstudio', baseUrl: 'http://localhost:1234/v1', models: ['*'], enabled: true, priority: 3, credits: 999999, successCount: 0, errorCount: 0 },
      { id: 'ollama-alt', name: 'Ollama Alt (Local) 🏠', type: 'ollama', baseUrl: 'http://localhost:11434', models: ['llama3', 'mistral', 'phi3'], enabled: false, priority: 3, credits: 999999, successCount: 0, errorCount: 0 },
      
      // CLOUD GPU PROVIDERS
      { id: 'aws-bedrock', name: 'AWS Bedrock ☁️', type: 'custom', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', apiKey: key('AWS_ACCESS_KEY_ID'), models: ['anthropic.claude-3-haiku-20240307-v1:0', 'anthropic.claude-3-5-haiku-20241007-v1:0', 'meta.llama3-1-70b-instruct-v1:0'], enabled: true, priority: 3, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'google-vertex', name: 'Google Vertex AI 🎯', type: 'google', baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1', apiKey: key('GOOGLE_CLOUD_API_KEY'), models: ['gemini-1.5-pro-002', 'gemini-1.5-flash-002'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'oracle-ai', name: 'Oracle Cloud AI 🏛️', type: 'custom', baseUrl: 'https://inference.ai.ocp.oraclecloud.com', apiKey: key('ORACLE_API_KEY'), models: ['*'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'nvidia-gpu', name: 'NVIDIA GPU Cloud 🎮', type: 'nvidia', baseUrl: 'https://api.ngc.nvidia.com/v1', apiKey: key('NVIDIA_API_KEY'), models: ['*'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'replicate-cloud', name: 'Replicate 🔄', type: 'replicate', baseUrl: 'https://api.replicate.com/v1', apiKey: key('REPLICATE_API_KEY'), models: ['meta/llama-3-70b-instruct', 'mistralai/mixtral-8x7b-instruct'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'fal-ai', name: 'Fal.ai 🔥', type: 'fal', baseUrl: 'https://api.fal.ai/v1', apiKey: key('FAL_API_KEY'), models: ['*'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'runpod-cloud', name: 'RunPod ⚙️', type: 'custom', baseUrl: 'https://api.runpod.io/v2', apiKey: key('RUNPOD_API_KEY'), models: ['meta-llama/Llama-3.1-70B-Instruct'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      
      // ADDITIONAL FREE/CHEAP
      { id: 'novita-free', name: 'Novita AI 💎', type: 'custom', baseUrl: 'https://api.novita.ai/v3', apiKey: key('NOVITA_API_KEY'), models: ['*'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'mistral-free', name: 'Mistral AI 🌊', type: 'custom', baseUrl: 'https://api.mistral.ai/v1', apiKey: key('MISTRAL_API_KEY'), models: ['mistral-small-latest', 'mistral-tiny'], enabled: true, priority: 2, credits: 0, successCount: 0, errorCount: 0 },
      { id: 'openai-free', name: 'OpenAI (Free Tier) 🤯', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: key('OPENAI_API_KEY'), models: ['gpt-4o-mini', 'gpt-4o'], enabled: true, priority: 3, credits: 0, successCount: 0, errorCount: 0 },
    ];
    defaultProviders.forEach(p => this.providers.set(p.id, p));
  }

  private initializeAgents() {
    const agentNames = ['Alpha 🐝', 'Beta 🐝', 'Gamma 🐝', 'Delta 🐝', 'Epsilon 🐝', 'Zeta 🐝', 'Eta 🐝', 'Theta 🐝', 'Iota 🐝', 'Kappa 🐝', 'Lambda 🐝', 'Mu 🐝', 'Nu 🐝', 'Xi 🐝', 'Omicron 🐝', 'Pi 🐝', 'Rho 🐝', 'Sigma 🐝', 'Tau 🐝', 'Upsilon 🐝', 'Phi 🐝', 'Chi 🐝', 'Psi 🐝', 'Omega 🐝'];
    const providerList = Array.from(this.providers.values()).filter(p => p.enabled);
    agentNames.forEach((name, i) => {
      const provider = providerList[i % providerList.length];
      const cleanId = name.toLowerCase().replace(/[^a-z]/g, '');
      this.agents.set(cleanId, { 
        id: cleanId, 
        name, 
        provider: provider.id, 
        model: provider.models[0], 
        status: 'idle',
        totalRequests: 0,
        successRate: 100
      });
    });
  }

  async sendMessage(message: string, agentId?: string): Promise<any> {
    const startTime = Date.now();
    if (agentId && this.agents.has(agentId)) {
      const agent = this.agents.get(agentId)!;
      const provider = this.providers.get(agent.provider);
      if (provider) return await this.callProvider(provider, message, agent.model);
    }
    const results = await this.swarmBroadcast(message);
    return { success: true, swarmResults: results, totalAgents: this.agents.size, activeProviders: Array.from(this.providers.values()).filter(p => p.enabled).length };
  }

  private async swarmBroadcast(message: string): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    const startTime = Date.now();
    const agentList = Array.from(this.agents.values()).filter(a => a.status !== 'working').slice(0, 8);
    
    const promises = agentList.map(async (agent) => {
      const agentStartTime = Date.now();
      const provider = this.providers.get(agent.provider);
      if (!provider || !provider.enabled) return null;
      try {
        agent.status = 'working';
        agent.currentTask = message.substring(0, 50);
        const result = await this.callProvider(provider, message, agent.model);
        const latency = Date.now() - agentStartTime;
        agent.status = 'idle';
        agent.lastUsed = new Date();
        agent.totalRequests++;
        provider.successCount++;
        
        results.push({ success: true, result: typeof result === 'string' ? result : JSON.stringify(result), agentId: agent.name, provider: provider.name, model: agent.model, latencyMs: latency, timestamp: new Date() });
        return result;
      } catch (error: any) {
        agent.status = 'error';
        agent.totalRequests++;
        provider.errorCount++;
        results.push({ success: false, error: error.message, agentId: agent.name, provider: provider?.name || 'unknown', model: agent.model, latencyMs: Date.now() - agentStartTime, timestamp: new Date() });
        return null;
      }
    });
    
    await Promise.allSettled(promises);
    
    // Add to history
    this.addToHistory(message, 'swarm', results);
    
    return results;
  }

  private addToHistory(task: string, strategy: string, results: TaskResult[]) {
    const entry: HistoryEntry = {
      id: `entry-${Date.now()}`,
      timestamp: new Date(),
      task,
      strategy,
      results,
      totalAgents: results.length,
      successCount: results.filter(r => r.success).length,
      avgLatency: results.length > 0 ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length : 0
    };
    this.history.unshift(entry);
    if (this.history.length > this.maxHistorySize) this.history.pop();
  }

  private async callProvider(provider: Provider, message: string, model: string): Promise<any> {
    const startTime = Date.now();
    switch (provider.type) {
      case 'openai': return await this.callOpenAI(provider, message, model);
      case 'anthropic': return await this.callAnthropic(provider, message, model);
      case 'google': return await this.callGoogle(provider, message, model);
      case 'ollama': return await this.callOllama(provider, message, model);
      case 'lmstudio': return await this.callLMStudio(provider, message, model);
      case 'cloudflare': return await this.callCloudflare(provider, message, model);
      case 'replicate': return await this.callReplicate(provider, message, model);
      case 'fal': return await this.callFal(provider, message, model);
      case 'nvidia': return await this.callNvidiaNGC(provider, message, model);
      default: return await this.callOpenAICompatible(provider, message, model);
    }
  }

  private async callOpenAI(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key - configure GROQ_API_KEY in Settings > Advanced' };
    const response = await axios.post(`${provider.baseUrl}/chat/completions`, { model, messages: [{ role: 'user', content: message }], max_tokens: 4096, temperature: 0.7 }, { headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return response.data.choices[0]?.message?.content || 'No response';
  }

  private async callAnthropic(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key - configure ANTHROPIC_API_KEY in Settings > Advanced' };
    const response = await axios.post(`${provider.baseUrl}/messages`, { model, max_tokens: 4096, messages: [{ role: 'user', content: message }] }, { headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, timeout: 60000 });
    return response.data.content[0]?.text || 'No response';
  }

  private async callGoogle(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key - configure GOOGLE_API_KEY in Settings > Advanced' };
    const response = await axios.post(`${provider.baseUrl}/models/${model}:generateContent?key=${provider.apiKey}`, { contents: [{ parts: [{ text: message }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }, { headers: { 'Content-Type': 'application/json' }, timeout: 60000 });
    return response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
  }

  private async callOllama(provider: Provider, message: string, model: string): Promise<any> {
    const response = await axios.post(`${provider.baseUrl}/api/chat`, { model, messages: [{ role: 'user', content: message }], stream: false }, { timeout: 300000 });
    return response.data.message?.content || 'No response';
  }

  private async callLMStudio(provider: Provider, message: string, model: string): Promise<any> {
    const modelField = model === '*' ? undefined : model;
    const response = await axios.post(`${provider.baseUrl}/chat/completions`, { model: modelField, messages: [{ role: 'user', content: message }], stream: false }, { timeout: 300000 });
    return response.data.choices?.[0]?.message?.content || 'No response';
  }

  private async callCloudflare(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey || !provider.baseUrl.includes('accounts')) return { error: 'Configure CF_API_KEY and CF_ACCOUNT_ID in Settings > Advanced' };
    const response = await axios.post(`${provider.baseUrl}/${model}`, { messages: [{ role: 'user', content: message }] }, { headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return response.data.result?.response || 'No response';
  }

  private async callReplicate(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key' };
    const response = await axios.post('https://api.replicate.com/v1/predictions', { version: model, input: { prompt: message } }, { headers: { 'Authorization': `Token ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });
    return `Prediction: ${response.data.id}`;
  }

  private async callFal(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key' };
    const response = await axios.post(`${provider.baseUrl}/${model}`, { prompt: message }, { headers: { 'Authorization': `Key ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return response.data?.output || 'Queued';
  }

  private async callNvidiaNGC(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key - configure NVIDIA_API_KEY in Settings > Advanced' };
    return { error: 'NVIDIA NGC requires additional setup - check docs' };
  }

  private async callOpenAICompatible(provider: Provider, message: string, model: string): Promise<any> {
    if (!provider.apiKey) return { error: 'No API key - add your API key in Settings > Advanced' };
    try {
      const response = await axios.post(`${provider.baseUrl}/chat/completions`, { model, messages: [{ role: 'user', content: message }], max_tokens: 4096, temperature: 0.7 }, { headers: { 'Authorization': `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
      return response.data.choices?.[0]?.message?.content || 'No response';
    } catch (error: any) {
      if (error.response?.status === 401) return { error: 'Invalid API key' };
      if (error.response?.status === 429) return { error: 'Rate limited - try another provider' };
      throw error;
    }
  }

  async addProvider(config: Provider): Promise<boolean> {
    const id = `custom-${Date.now()}`;
    this.providers.set(id, { ...config, id, successCount: 0, errorCount: 0 });
    return true;
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    if (providerId.startsWith('ollama') || providerId.startsWith('lmstudio') || providerId.startsWith('groq') || providerId.startsWith('cerebras')) {
      return false; // Can't delete default providers
    }
    return this.providers.delete(providerId);
  }

  async testProvider(config: Provider): Promise<{ success: boolean; latency: number; error?: string }> {
    const startTime = Date.now();
    try {
      const testMessage = 'Reply with just "OK"';
      if (config.type === 'google') await this.callGoogle(config, testMessage, config.models[0]);
      else if (config.type === 'ollama' || config.type === 'lmstudio') await this.callOllama(config, testMessage, config.models[0]);
      else if (config.type === 'cloudflare') await this.callCloudflare(config, testMessage, config.models[0]);
      else await this.callOpenAICompatible(config, testMessage, config.models[0]);
      return { success: true, latency: Date.now() - startTime };
    } catch (error: any) {
      return { success: false, latency: Date.now() - startTime, error: error.message };
    }
  }

  async delegateTask(task: string, strategy: string): Promise<any> {
    switch (strategy) {
      case 'fastest': return await this.delegateToFastest(task);
      case 'cheapest': return await this.delegateToCheapest(task);
      case 'smart': return await this.delegateSmart(task);
      case 'parallel': return await this.swarmBroadcast(task);
      default: return await this.sendMessage(task);
    }
  }

  private async delegateToFastest(task: string): Promise<any> {
    const sortedProviders = Array.from(this.providers.values()).filter(p => p.enabled).sort((a, b) => a.priority - b.priority);
    for (const provider of sortedProviders) {
      try { 
        const startTime = Date.now();
        const result = await this.callProvider(provider, task, provider.models[0]); 
        provider.lastLatency = Date.now() - startTime;
        return { success: true, result, provider: provider.name, latency: provider.lastLatency }; 
      } catch (e) { continue; }
    }
    return { success: false, error: 'All providers failed' };
  }

  private async delegateToCheapest(task: string): Promise<any> {
    const freeProviders = Array.from(this.providers.values()).filter(p => p.enabled && (p.credits === undefined || p.credits > 0 || p.credits > 999)).sort((a, b) => (a.credits || 0) - (b.credits || 0));
    for (const provider of freeProviders) {
      try { const result = await this.callProvider(provider, task, provider.models[0]); return { success: true, result, provider: provider.name }; } catch (e) { continue; }
    }
    return { success: false, error: 'All free providers exhausted' };
  }

  async delegateSmart(task: string): Promise<any> {
    const isComplex = task.length > 1000 || task.includes('code') || task.includes('analyze') || task.includes('write') || task.includes('create');
    const targetProviders = isComplex ? 
      Array.from(this.providers.values()).filter(p => p.enabled && p.priority <= 2) : 
      Array.from(this.providers.values()).filter(p => p.enabled && p.priority <= 1);
    for (const provider of targetProviders) {
      try { const result = await this.callProvider(provider, task, provider.models[0]); return { success: true, result, provider: provider.name }; } catch (e) { continue; }
    }
    return { success: false, error: 'All providers failed' };
  }

  getProviders(): Provider[] { return Array.from(this.providers.values()); }
  getAgents(): Agent[] { return Array.from(this.agents.values()); }
  setModel(providerId: string, model: string): void { const p = this.providers.get(providerId); if (p) p.models[0] = model; }
  getStats() { 
    const providers = Array.from(this.providers.values());
    return { 
      providers: providers.length, 
      agents: this.agents.size, 
      activeProviders: providers.filter(p => p.enabled).length,
      totalRequests: providers.reduce((sum, p) => sum + p.successCount + p.errorCount, 0),
      successRate: providers.length > 0 ? Math.round((providers.reduce((sum, p) => sum + p.successCount, 0) / Math.max(1, providers.reduce((sum, p) => sum + p.successCount + p.errorCount, 0))) * 100) : 0
    }; 
  }
  getHistory(): HistoryEntry[] { return this.history.slice(0, 20); }
  clearHistory(): void { this.history = []; }
}