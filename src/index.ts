#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AutomateClient, AutomateConfig } from './automate-client.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const config: AutomateConfig = {
  serverUrl: process.env.AUTOMATE_SERVER_URL || '',
  username: process.env.AUTOMATE_USERNAME || '',
  password: process.env.AUTOMATE_PASSWORD || '',
  twoFactorPasscode: process.env.AUTOMATE_2FA_PASSCODE,
};

if (!config.serverUrl || !config.username || !config.password) {
  console.error('ERROR: Missing required ConnectWise Automate credentials in environment variables');
  console.error('Required: AUTOMATE_SERVER_URL, AUTOMATE_USERNAME, AUTOMATE_PASSWORD');
  console.error('Optional: AUTOMATE_2FA_PASSCODE');
  process.exit(1);
}

const automateClient = new AutomateClient(config);

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'connectwise-automate-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [

      // ── Computers / Agents ──────────────────────────────────────────────────
      {
        name: 'get_computers',
        description:
          'Search for computers (managed agents) in ConnectWise Automate. ' +
          'Use the condition parameter to filter results (e.g. "ClientId=5", ' +
          '"OperatingSystem like \'%Windows 10%\'", "ComputerName=\'DESKTOP-ABC123\'"). ' +
          'Supports pagination and sorting.',
        inputSchema: {
          type: 'object',
          properties: {
            condition: {
              type: 'string',
              description:
                'Automate filter condition (optional). Examples: "ClientId=5", ' +
                '"OperatingSystem like \'%Server%\'", "ComputerName=\'mypc\'"',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 25, max: 1000)',
              default: 25,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
            orderBy: {
              type: 'string',
              description:
                'Field to sort by with optional direction (e.g. "ComputerName asc", "LastContact desc")',
            },
          },
        },
      },

      {
        name: 'get_computer',
        description: 'Get detailed information about a specific computer/agent by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            computerId: {
              type: 'number',
              description: 'The computer ID',
            },
          },
          required: ['computerId'],
        },
      },

      // ── Clients ─────────────────────────────────────────────────────────────
      {
        name: 'get_clients',
        description:
          'Search for clients (companies/organisations) in ConnectWise Automate. ' +
          'Use condition to filter, e.g. "Name like \'%Acme%\'".',
        inputSchema: {
          type: 'object',
          properties: {
            condition: {
              type: 'string',
              description: 'Automate filter condition (optional). Example: "Name like \'%Acme%\'"',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 25, max: 1000)',
              default: 25,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
            orderBy: {
              type: 'string',
              description: 'Field to sort by (e.g. "Name asc")',
            },
          },
        },
      },

      {
        name: 'get_client',
        description: 'Get detailed information about a specific client by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            clientId: {
              type: 'number',
              description: 'The client ID',
            },
          },
          required: ['clientId'],
        },
      },

      // ── Locations ────────────────────────────────────────────────────────────
      {
        name: 'get_locations',
        description:
          'Search for locations in ConnectWise Automate. ' +
          'Locations are sub-groupings within a client. ' +
          'Use condition to filter, e.g. "ClientId=5".',
        inputSchema: {
          type: 'object',
          properties: {
            condition: {
              type: 'string',
              description: 'Automate filter condition (optional). Example: "ClientId=5"',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 25, max: 1000)',
              default: 25,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
            orderBy: {
              type: 'string',
              description: 'Field to sort by (e.g. "Name asc")',
            },
          },
        },
      },

      {
        name: 'get_location',
        description: 'Get detailed information about a specific location by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            locationId: {
              type: 'number',
              description: 'The location ID',
            },
          },
          required: ['locationId'],
        },
      },

      // ── Groups ───────────────────────────────────────────────────────────────
      {
        name: 'get_groups',
        description:
          'Search for agent groups in ConnectWise Automate. ' +
          'Groups are used to organise and target computers for scripts and monitoring.',
        inputSchema: {
          type: 'object',
          properties: {
            condition: {
              type: 'string',
              description: 'Automate filter condition (optional). Example: "Name like \'%Servers%\'"',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 25, max: 1000)',
              default: 25,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
            orderBy: {
              type: 'string',
              description: 'Field to sort by (e.g. "Name asc")',
            },
          },
        },
      },

      {
        name: 'get_group',
        description: 'Get detailed information about a specific agent group by its ID.',
        inputSchema: {
          type: 'object',
          properties: {
            groupId: {
              type: 'number',
              description: 'The group ID',
            },
          },
          required: ['groupId'],
        },
      },

      // ── Analytics ────────────────────────────────────────────────────────────
      {
        name: 'get_computers_summary',
        description:
          'Get an aggregated summary of all computers/agents without returning raw records. ' +
          'Returns total count, online vs offline split, breakdown by client, and breakdown by OS type. ' +
          'Use this instead of get_computers when you want overview stats — avoids token overflow on large environments.',
        inputSchema: {
          type: 'object',
          properties: {
            clientId: {
              type: 'number',
              description: 'Limit the summary to a specific client ID (optional)',
            },
          },
        },
      },

      {
        name: 'get_offline_computers',
        description:
          'Find computers that have not checked in to Automate within a specified number of days. ' +
          'Useful for identifying dead agents or machines that are switched off. ' +
          'Defaults to computers offline for more than 1 day.',
        inputSchema: {
          type: 'object',
          properties: {
            daysOffline: {
              type: 'number',
              description:
                'Return computers with no check-in in this many days (default: 1). ' +
                'Use 7 for a week, 30 for a month, etc.',
              default: 1,
            },
            clientId: {
              type: 'number',
              description: 'Limit results to a specific client ID (optional)',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 100)',
              default: 100,
            },
          },
        },
      },
    ],
  };
});

// ─── Tool Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    const params = (args || {}) as Record<string, any>;

    switch (name) {

      // ── Computers ────────────────────────────────────────────────────────────
      case 'get_computers': {
        const result = await automateClient.getComputers(
          params.condition,
          params.pageSize,
          params.page,
          params.orderBy
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_computer': {
        const result = await automateClient.getComputerById(params.computerId as number);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Clients ──────────────────────────────────────────────────────────────
      case 'get_clients': {
        const result = await automateClient.getClients(
          params.condition,
          params.pageSize,
          params.page,
          params.orderBy
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_client': {
        const result = await automateClient.getClientById(params.clientId as number);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Locations ────────────────────────────────────────────────────────────
      case 'get_locations': {
        const result = await automateClient.getLocations(
          params.condition,
          params.pageSize,
          params.page,
          params.orderBy
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_location': {
        const result = await automateClient.getLocationById(params.locationId as number);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Groups ───────────────────────────────────────────────────────────────
      case 'get_groups': {
        const result = await automateClient.getGroups(
          params.condition,
          params.pageSize,
          params.page,
          params.orderBy
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_group': {
        const result = await automateClient.getGroupById(params.groupId as number);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Analytics ────────────────────────────────────────────────────────────
      case 'get_computers_summary': {
        const result = await automateClient.getComputersSummary(params.clientId as number | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_offline_computers': {
        const result = await automateClient.getOfflineComputers(
          params.daysOffline as number | undefined,
          params.clientId as number | undefined,
          params.pageSize as number | undefined
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data, null, 2)
      : '';
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}${detail ? '\n' + detail : ''}`,
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ConnectWise Automate MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
