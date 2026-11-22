// Cliente de IA compatível com a API da OpenAI.
// Por omissão usa o NVIDIA Nemotron (build.nvidia.com), mas qualquer serviço
// compatível funciona: basta mudar AI_BASE_URL / AI_MODEL / AI_API_KEY.
export class AIClient {
  constructor({ baseURL, apiKey, model, temperature = 0.4, fetchImpl = globalThis.fetch } = {}) {
    this.baseURL = (baseURL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model || 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
    this.temperature = temperature;
    this.fetch = fetchImpl;
    this.toolsUnsupported = false;
  }

  get enabled() { return !!this.apiKey; }

  /** Devolve { content, toolCalls: [{id, name, args}] } */
  async chat(messages, tools) {
    const body = { model: this.model, messages, temperature: this.temperature, max_tokens: 600 };
    if (tools?.length && !this.toolsUnsupported) { body.tools = tools; body.tool_choice = 'auto'; }
    let res = await this.post(body);
    if (!res.ok && body.tools && res.status === 400) {
      // Alguns modelos não suportam ferramentas: tenta outra vez sem elas.
      this.toolsUnsupported = true;
      delete body.tools; delete body.tool_choice;
      res = await this.post(body);
    }
    if (!res.ok) throw new Error(`IA respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const m = json.choices?.[0]?.message || {};
    // Remove raciocínio interno que alguns modelos (Nemotron) põem entre <think>...</think>
    const content = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const toolCalls = (m.tool_calls || []).map(tc => {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ignora */ }
      return { id: tc.id, name: tc.function?.name, args };
    });
    return { content, toolCalls, raw: m };
  }

  post(body) {
    return this.fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  }
}

export const AI_TOOLS_PUBLIC = [
  {
    type: 'function',
    function: {
      name: 'verificar_numero',
      description: 'Verifica se um número de telefone tem denúncias de fraude ou está banido.',
      parameters: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    },
  },
];

export const AI_TOOLS_ADMIN = [
  ...AI_TOOLS_PUBLIC,
  {
    type: 'function',
    function: {
      name: 'definir_preco',
      description: 'Cria ou actualiza um pacote na tabela de preços.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'ex: "1GB Vodacom"' },
          preco: { type: 'number', description: 'preço em meticais' },
          validade: { type: 'string', description: 'ex: "24h", "7 dias"' },
        },
        required: ['nome', 'preco'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remover_pacote',
      description: 'Remove um pacote da tabela de preços.',
      parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
    },
  },
  {
    type: 'function',
    function: { name: 'ver_fila', description: 'Lista os pedidos pendentes.', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'concluir_pedido',
      description: 'Marca um pedido como enviado e avisa o cliente.',
      parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'banir_numero',
      description: 'Bane um número por fraude (lista negra global).',
      parameters: { type: 'object', properties: { numero: { type: 'string' }, motivo: { type: 'string' } }, required: ['numero'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'anunciar',
      description: 'Envia um anúncio para o grupo actual, mencionando todos os membros.',
      parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    },
  },
];
