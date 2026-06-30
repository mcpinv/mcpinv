import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec } from '../src/openapi.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const tools: Tool[] = [
  {
    name: 'create_issue',
    description: 'Create a GitHub issue',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_repos',
    description: 'List repositories',
    inputSchema: { type: 'object', properties: {} }
  }
]

describe('generateOpenApiSpec', () => {
  it('returns valid OpenAPI 3.1 structure', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('github MCP Bridge')
  })

  it('maps each tool to a POST path', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.paths['/tools/create_issue']).toBeDefined()
    expect(spec.paths['/tools/list_repos']).toBeDefined()
    expect(spec.paths['/tools/create_issue'].post.operationId).toBe('create_issue')
  })

  it('uses tool description as summary', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.paths['/tools/create_issue'].post.summary).toBe('Create a GitHub issue')
  })

  it('inlines inputSchema as requestBody', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    const schema = spec.paths['/tools/create_issue'].post.requestBody.content['application/json'].schema
    expect(schema.properties.title).toEqual({ type: 'string' })
  })

  it('handles empty tool list', () => {
    const spec = generateOpenApiSpec('empty', []) as any
    expect(spec.paths).toEqual({})
  })
})
