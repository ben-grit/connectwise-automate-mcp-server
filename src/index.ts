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
  clientId: process.env.AUTOMATE_CLIENT_ID || '',
  twoFactorPasscode: process.env.AUTOMATE_2FA_PASSCODE,
};

if (!config.serverUrl || !config.username || !config.password || !config.clientId) {
  console.error('ERROR: Missing required ConnectWise Automate credentials in environment variables');
  console.error('Required: AUTOMATE_SERVER_URL, AUTOMATE_USERNAME, AUTOMATE_PASSWORD, AUTOMATE_CLIENT_ID');
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
          'Use the condition parameter to filter results (e.g. ' +
          '"ComputerName=\'DESKTOP-ABC123\'", "OperatingSystemName like \'%Windows 10%\'", "Type=\'Server\'"). ' +
          'To filter by client/company, use get_computers_by_client instead (ClientId conditions are unreliable). ' +
          'Returns compact records by default (strips large port/IRQ arrays). ' +
          'Supports pagination and sorting.',
        inputSchema: {
          type: 'object',
          properties: {
            condition: {
              type: 'string',
              description:
                'Automate filter condition (optional). Examples: ' +
                '"ComputerName=\'mypc\'", "OperatingSystemName like \'%Server%\'", "Type=\'Server\'". ' +
                'NOTE: Do not use ClientId here — use the get_computers_by_client tool for client-based filtering.',
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
            compact: {
              type: 'boolean',
              description:
                'Return compact records (default: true). Set to false to include raw port/IRQ/DMA arrays.',
              default: true,
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

      {
        name: 'get_computer_software',
        description:
          'Get installed software/applications for a specific computer by its ID. ' +
          'Returns application name, version, install date, and size. ' +
          'Use nameFilter for quick partial-match searches (e.g. "Chrome", "Adobe"). ' +
          'Useful for auditing installed software or planning replacement computer builds.',
        inputSchema: {
          type: 'object',
          properties: {
            computerId: {
              type: 'number',
              description: 'The computer ID to retrieve software for',
            },
            nameFilter: {
              type: 'string',
              description:
                'Filter software by name (partial match, e.g. "Chrome", "Adobe", "Office"). ' +
                'Convenience shortcut that builds a Name like condition.',
            },
            condition: {
              type: 'string',
              description:
                'Raw Automate condition for advanced filtering (optional). ' +
                'Example: "Name like \'%Visual Studio%\'"',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 200)',
              default: 200,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
          },
          required: ['computerId'],
        },
      },

      {
        name: 'get_computers_by_client',
        description:
          'Search for computers belonging to a specific client by client name (partial match). ' +
          'Convenience wrapper — no need to look up a client ID first. ' +
          'If multiple clients match the name, returns the list of matches so you can be more specific.',
        inputSchema: {
          type: 'object',
          properties: {
            clientName: {
              type: 'string',
              description: 'Client name to search for (partial match, e.g. "Northrop" or "Westside")',
            },
            pageSize: {
              type: 'number',
              description: 'Number of computers to return (default: 25, max: 1000)',
              default: 25,
            },
            page: {
              type: 'number',
              description: 'Page number for pagination (default: 1)',
              default: 1,
            },
            orderBy: {
              type: 'string',
              description: 'Field to sort by (e.g. "ComputerName asc", "LastContact desc")',
            },
          },
          required: ['clientName'],
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

      {
        name: 'get_stale_computers',
        description:
          'Find computers whose Automate agent has not checked in for more than a given number of days. ' +
          'Similar to get_offline_computers but with a longer default horizon (30 days) and an optional ' +
          'type filter — useful for identifying truly dead/retired agents vs. machines that are just ' +
          'temporarily offline. Use typeFilter to limit to "Workstation" or "Server".',
        inputSchema: {
          type: 'object',
          properties: {
            daysOld: {
              type: 'number',
              description: 'Flag computers not checked in for this many days (default: 30)',
              default: 30,
            },
            clientId: {
              type: 'number',
              description: 'Limit to a specific client ID (optional)',
            },
            typeFilter: {
              type: 'string',
              description: 'Limit to a specific computer type: "Workstation" or "Server" (optional)',
            },
            pageSize: {
              type: 'number',
              description: 'Number of results to return (default: 100)',
              default: 100,
            },
          },
        },
      },
      // ── Cross-reference ────────────────────────────────────────────────────
      {
        name: 'batch_check_computers',
        description:
          'Check a list of computer names against Automate in a single call. ' +
          'For each name, returns whether an agent exists, its status (Online/Offline), ' +
          'last contact time, and client name. Designed for bulk cross-referencing ' +
          'PSA configurations against Automate agents.',
        inputSchema: {
          type: 'object',
          properties: {
            computerNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of computer/hostname names to look up (e.g. ["WKS-001", "DESKTOP-ABC"]). Max 50 per call.',
            },
          },
          required: ['computerNames'],
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
          params.orderBy,
          params.compact !== false   // default true unless explicitly set to false
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

      case 'get_computer_software': {
        const conditions: string[] = [];
        if (params.nameFilter) {
          conditions.push(`Name like '%${params.nameFilter}%'`);
        }
        if (params.condition) {
          conditions.push(params.condition);
        }
        const condition = conditions.length > 0 ? conditions.join(' AND ') : undefined;
        const result = await automateClient.getComputerSoftware(
          params.computerId as number,
          condition,
          params.pageSize,
          params.page
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_computers_by_client': {
        const result = await automateClient.getComputersByClient(
          params.clientName as string,
          params.pageSize,
          params.page,
          params.orderBy
        );
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

      case 'get_stale_computers': {
        const result = await automateClient.getStaleComputers(
          params.daysOld as number | undefined,
          params.clientId as number | undefined,
          params.typeFilter as string | undefined,
          params.pageSize as number | undefined
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Cross-reference ──────────────────────────────────────────────────────
      case 'batch_check_computers': {
        const names: string[] = params.computerNames as string[];
        if (!names || names.length === 0) {
          throw new Error('computerNames array is required and must not be empty');
        }
        if (names.length > 50) {
          throw new Error('Maximum 50 computer names per call');
        }
        const result = await automateClient.batchCheckComputers(names);
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
