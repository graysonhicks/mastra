import { createAnthropic } from '@ai-sdk/anthropic-v5';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock-v5';
import { createAzure } from '@ai-sdk/azure-v5';
import { createGoogleGenerativeAI } from '@ai-sdk/google-v5';
import { createVertex } from '@ai-sdk/google-vertex-v5';
import { createMistral } from '@ai-sdk/mistral-v5';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible-v5';
import { createOpenAI } from '@ai-sdk/openai-v5';
import type { LanguageModelV2 } from '@ai-sdk/provider-v5';
import { createXai } from '@ai-sdk/xai-v5';
import { createOpenRouter } from '@openrouter/ai-sdk-provider-v5';
import { parseModelRouterId } from '../gateway-resolver.js';
import { MastraModelGateway } from './base.js';
import type { ProviderConfig } from './base.js';
import { EXCLUDED_PROVIDERS, PROVIDERS_WITH_INSTALLED_PACKAGES } from './constants.js';

interface ModelsDevProviderInfo {
  id: string;
  name: string;
  models: Record<string, any>;
  env?: string[]; // Array of env var names
  api?: string; // Base API URL
  npm?: string; // NPM package name
  doc?: string; // Documentation URL
}

interface ModelsDevResponse {
  [providerId: string]: ModelsDevProviderInfo;
}

const CUSTOM_API_KEY_ENV_VARS: Record<string, string> = {
  'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
  azure: 'AZURE_API_KEY',
  'google-vertex': 'GOOGLE_APPLICATION_CREDENTIALS',
};

const AWS_REGION_ENV_FALLBACKS = ['AMAZON_BEDROCK_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'];
const GOOGLE_PROJECT_ENV_FALLBACKS = ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'];
const GOOGLE_LOCATION_ENV_FALLBACKS = ['GOOGLE_VERTEX_LOCATION', 'GOOGLE_CLOUD_REGION', 'GCP_REGION'];

// Special cases: providers that are OpenAI-compatible but have their own SDKs
// These providers work with OpenAI-compatible endpoints even though models.dev
// might list them with their own SDK packages
// This constant is ONLY used during generation in fetchProviders() to determine
// which providers from models.dev should be included in the registry.
// At runtime, buildUrl() and buildHeaders() use the pre-generated PROVIDER_REGISTRY instead.
const OPENAI_COMPATIBLE_OVERRIDES: Record<string, Partial<ProviderConfig>> = {
  cerebras: {
    url: 'https://api.cerebras.ai/v1',
  },
  mistral: {
    url: 'https://api.mistral.ai/v1',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1',
  },
  togetherai: {
    url: 'https://api.together.xyz/v1',
  },
  deepinfra: {
    url: 'https://api.deepinfra.com/v1/openai',
  },
  perplexity: {
    url: 'https://api.perplexity.ai',
  },
  vercel: {
    url: 'https://ai-gateway.vercel.sh/v1',
    apiKeyEnvVar: 'AI_GATEWAY_API_KEY',
  },
};

function resolveEnvValue(envNames: string[]): string | undefined {
  for (const envName of envNames) {
    if (envName && process.env[envName]) {
      return process.env[envName];
    }
  }
  return undefined;
}

function deriveApiKeyEnvVar(providerId: string, providerInfo: ModelsDevProviderInfo): string | string[] {
  const envVars = providerInfo.env ?? [];
  if (CUSTOM_API_KEY_ENV_VARS[providerId]) {
    return CUSTOM_API_KEY_ENV_VARS[providerId];
  }

  if (envVars.length === 0) {
    return `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  }

  if (envVars.length === 1) {
    return envVars[0] ?? `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  }

  return envVars;
}

export class ModelsDevGateway extends MastraModelGateway {
  readonly id = 'models.dev';
  readonly name = 'models.dev';
  readonly prefix = undefined; // No prefix for registry gateway

  private providerConfigs: Record<string, ProviderConfig> = {};

  constructor(providerConfigs?: Record<string, ProviderConfig>) {
    super();
    if (providerConfigs) this.providerConfigs = providerConfigs;
  }

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    const response = await fetch('https://models.dev/api.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch from models.dev: ${response.statusText}`);
    }

    const data = (await response.json()) as ModelsDevResponse;

    const providerConfigs: Record<string, ProviderConfig> = {};

    for (const [providerId, providerInfo] of Object.entries(data)) {
      // Skip excluded providers
      if (EXCLUDED_PROVIDERS.includes(providerId)) continue;
      // Skip non-provider entries (if any)
      if (!providerInfo || typeof providerInfo !== 'object' || !providerInfo.models) continue;

      // Use provider ID as-is (keep hyphens for consistency)
      const normalizedId = providerId;

      // Check if this is OpenAI-compatible based on npm package or overrides
      const isOpenAICompatible =
        providerInfo.npm === '@ai-sdk/openai-compatible' ||
        providerInfo.npm === '@ai-sdk/gateway' || // Vercel AI Gateway is OpenAI-compatible
        normalizedId in OPENAI_COMPATIBLE_OVERRIDES;

      // these have their ai sdk provider package installed and don't use openai-compat
      const hasInstalledPackage = PROVIDERS_WITH_INSTALLED_PACKAGES.includes(providerId);

      // Also include providers that have an API URL and env vars (likely OpenAI-compatible)
      const hasApiAndEnv = providerInfo.api && providerInfo.env && providerInfo.env.length > 0;

      if (isOpenAICompatible || hasInstalledPackage || hasApiAndEnv) {
        const modelIds = Object.keys(providerInfo.models).sort();
        const url = providerInfo.api || OPENAI_COMPATIBLE_OVERRIDES[normalizedId]?.url;

        if (!hasInstalledPackage && !url) {
          continue;
        }

        const apiKeyEnvVar = deriveApiKeyEnvVar(normalizedId, providerInfo);
        const apiKeyHeader = !hasInstalledPackage
          ? OPENAI_COMPATIBLE_OVERRIDES[normalizedId]?.apiKeyHeader || 'Authorization'
          : undefined;

        providerConfigs[normalizedId] = {
          url,
          apiKeyEnvVar,
          apiKeyHeader,
          name: providerInfo.name || providerId.charAt(0).toUpperCase() + providerId.slice(1),
          models: modelIds,
          docUrl: providerInfo.doc,
          gateway: `models.dev`,
          packageName: providerInfo.npm,
          requiredEnvVars: providerInfo.env?.length ? providerInfo.env : undefined,
        };
      }
    }

    // Store for later use in buildUrl and buildHeaders
    this.providerConfigs = providerConfigs;

    return providerConfigs;
  }

  buildUrl(routerId: string, envVars?: typeof process.env): string | undefined {
    const { providerId } = parseModelRouterId(routerId);

    const config = this.providerConfigs[providerId];

    if (!config?.url) {
      return;
    }

    // Check for custom base URL from env vars
    const baseUrlEnvVar = `${providerId.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
    const customBaseUrl = envVars?.[baseUrlEnvVar] || process.env[baseUrlEnvVar];

    return customBaseUrl || config.url;
  }

  getApiKey(modelId: string): Promise<string> {
    const [provider, model] = modelId.split('/');
    if (!provider || !model) {
      throw new Error(`Could not identify provider from model id ${modelId}`);
    }
    const config = this.providerConfigs[provider];

    if (!config) {
      throw new Error(`Could not find config for provider ${provider} with model id ${modelId}`);
    }

    const envVars = Array.isArray(config.apiKeyEnvVar)
      ? config.apiKeyEnvVar
      : config.apiKeyEnvVar
        ? [config.apiKeyEnvVar]
        : [];

    let apiKey: string | undefined;
    let envVarName: string | undefined;
    for (const env of envVars) {
      if (env && process.env[env]) {
        envVarName = env;
        apiKey = process.env[env];
        break;
      }
    }

    if (!apiKey) {
      if (PROVIDERS_WITH_INSTALLED_PACKAGES.includes(provider)) {
        return Promise.resolve('');
      }

      envVarName = envVarName ?? envVars[0];
      throw new Error(
        `Could not find API key ${envVarName ? `process.env.${envVarName}` : 'environment variable'} for model id ${modelId}`,
      );
    }

    return Promise.resolve(apiKey);
  }

  async resolveLanguageModel({
    modelId,
    providerId,
    apiKey,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
  }): Promise<LanguageModelV2> {
    const baseURL = this.buildUrl(`${providerId}/${modelId}`);

    switch (providerId) {
      case 'openai':
        return createOpenAI({ apiKey }).responses(modelId);
      case 'gemini':
      case 'google':
        return createGoogleGenerativeAI({
          apiKey,
        }).chat(modelId);
      case 'anthropic':
        return createAnthropic({ apiKey })(modelId);
      case 'mistral':
        return createMistral({ apiKey })(modelId);
      case 'openrouter':
        return createOpenRouter({ apiKey })(modelId);
      case 'xai':
        return createXai({
          apiKey,
        })(modelId);
      case 'amazon-bedrock':
        return this.resolveAmazonBedrockModel(modelId);
      case 'azure':
        return this.resolveAzureModel(modelId);
      case 'google-vertex':
        return this.resolveGoogleVertexModel(modelId);
      default:
        if (!baseURL) throw new Error(`No API URL found for ${providerId}/${modelId}`);
        return createOpenAICompatible({ name: providerId, apiKey, baseURL, supportsStructuredOutputs: true }).chatModel(
          modelId,
        );
    }
  }

  private resolveAmazonBedrockModel(modelId: string): LanguageModelV2 {
    const region = resolveEnvValue(AWS_REGION_ENV_FALLBACKS);

    if (!region) {
      throw new Error('Amazon Bedrock requires AWS_REGION or AMAZON_BEDROCK_REGION to be set.');
    }

    const bedrockOptions: Parameters<typeof createAmazonBedrock>[0] = {
      region,
    };

    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      bedrockOptions.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      bedrockOptions.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    }

    if (process.env.AWS_SESSION_TOKEN) {
      bedrockOptions.sessionToken = process.env.AWS_SESSION_TOKEN;
    }

    const bedrock = createAmazonBedrock(bedrockOptions);
    return bedrock(modelId);
  }

  private resolveAzureModel(modelId: string): LanguageModelV2 {
    let resourceName = process.env.AZURE_RESOURCE_NAME || process.env.AZURE_OPENAI_RESOURCE;
    const apiKey = process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

    if (!resourceName && endpoint) {
      const match = endpoint.match(/https:\/\/([^.]+)\./);
      resourceName = match?.[1];
    }

    if (!resourceName) {
      throw new Error('Azure OpenAI requires AZURE_RESOURCE_NAME or AZURE_OPENAI_ENDPOINT to be set.');
    }

    if (!apiKey) {
      throw new Error('Azure OpenAI requires AZURE_API_KEY or AZURE_OPENAI_API_KEY to be set.');
    }

    const azure = createAzure({
      resourceName,
      apiKey,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    });

    return azure(modelId);
  }

  private resolveGoogleVertexModel(modelId: string): LanguageModelV2 {
    const project = resolveEnvValue(GOOGLE_PROJECT_ENV_FALLBACKS);
    const location = resolveEnvValue(GOOGLE_LOCATION_ENV_FALLBACKS);

    if (!project) {
      throw new Error('Google Vertex AI requires GOOGLE_VERTEX_PROJECT (or GOOGLE_CLOUD_PROJECT) to be set.');
    }

    if (!location) {
      throw new Error('Google Vertex AI requires GOOGLE_VERTEX_LOCATION (or GOOGLE_CLOUD_REGION) to be set.');
    }

    const googleAuthOptions: Record<string, string> = {};
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      googleAuthOptions.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    const vertex = createVertex({
      project,
      location,
      googleAuthOptions: Object.keys(googleAuthOptions).length ? googleAuthOptions : undefined,
    });

    return vertex(modelId);
  }
}
