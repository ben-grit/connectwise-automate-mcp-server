import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export interface AutomateConfig {
  serverUrl: string;        // e.g. "https://yourcompany.hostedrmm.com"
  username: string;
  password: string;
  clientId: string;         // ConnectWise developer clientId (same as PSA clientId)
  twoFactorPasscode?: string;
}

// Extend AxiosRequestConfig to track retry flag
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export class AutomateClient {
  private httpClient: AxiosInstance;
  private config: AutomateConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: AutomateConfig) {
    this.config = config;

    // Strip any trailing slash from serverUrl
    this.config = {
      ...config,
      serverUrl: config.serverUrl.replace(/\/$/, ''),
    };

    this.httpClient = axios.create({
      baseURL: `${this.config.serverUrl}/cwa/api/v1`,
      headers: {
        'Content-Type': 'application/json',
        'clientId': this.config.clientId,
      },
    });

    // Request interceptor: inject Bearer token before every request
    this.httpClient.interceptors.request.use(async (cfg: RetryableRequestConfig) => {
      await this.ensureAuthenticated();
      cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      return cfg;
    });

    // Response interceptor: on 401, re-auth once and retry
    this.httpClient.interceptors.response.use(
      (res) => res,
      async (error) => {
        const originalRequest = error.config as RetryableRequestConfig;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          this.accessToken = null;
          this.tokenExpiry = null;
          try {
            await this.authenticate();
            originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
            return this.httpClient(originalRequest);
          } catch (authError) {
            return Promise.reject(authError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // ─── Authentication ────────────────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const body: Record<string, string> = {
      UserName: this.config.username,
      Password: this.config.password,
    };
    if (this.config.twoFactorPasscode) {
      body['TwoFactorPasscode'] = this.config.twoFactorPasscode;
    }

    // Auth endpoint sits outside /cwa/api/v1, so we call it directly
    const response = await axios.post(
      `${this.config.serverUrl}/cwa/api/v1/apitoken`,
      body,
      { headers: { 'Content-Type': 'application/json' } }
    );

    this.accessToken = response.data.AccessToken as string;
    // Tokens last ~1 hour; refresh with a 60-second safety buffer
    this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);
  }

  private async ensureAuthenticated(): Promise<void> {
    const now = new Date();
    if (!this.accessToken || !this.tokenExpiry || now >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  // ─── Helper: paginated list ────────────────────────────────────────────────

  private async get(
    endpoint: string,
    condition?: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    const params: Record<string, string | number> = { pageSize, page };
    if (condition) params['condition'] = condition;
    if (orderBy) params['orderBy'] = orderBy;
    const response = await this.httpClient.get(endpoint, { params });
    return response.data;
  }

  /** Fetch ALL pages from a list endpoint (for analytics). */
  async getAllPages(endpoint: string, condition?: string): Promise<any[]> {
    const all: any[] = [];
    let page = 1;
    while (true) {
      const batch = await this.get(endpoint, condition, 1000, page);
      const items: any[] = Array.isArray(batch) ? batch : (batch?.items ?? []);
      all.push(...items);
      if (items.length < 1000) break;
      page++;
    }
    return all;
  }

  // ─── Computers / Agents ────────────────────────────────────────────────────

  async getComputers(
    condition?: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string,
    compact: boolean = true
  ): Promise<any> {
    const data = await this.get('/Computers', condition, pageSize, page, orderBy);
    if (!compact) return data;
    if (Array.isArray(data)) return data.map(compactComputer);
    return data;
  }

  async getComputerById(id: number): Promise<any> {
    const response = await this.httpClient.get(`/Computers/${id}`);
    return response.data;
  }

  async getComputerSoftware(
    computerId: number,
    condition?: string,
    pageSize: number = 200,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    const params: Record<string, string | number> = { pageSize, page };
    if (condition) params['condition'] = condition;
    if (orderBy) params['orderBy'] = orderBy;
    const response = await this.httpClient.get(`/Computers/${computerId}/Software`, { params });
    return response.data;
  }

  /**
   * Find computers by client name (partial match). Resolves the client name to
   * an ID first, then returns computers for that client in compact form.
   */
  async getComputersByClient(
    clientName: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    // Resolve client name → ID
    const clientData = await this.getClients(`Name like '%${clientName}%'`, 20);
    const clientList: any[] = Array.isArray(clientData) ? clientData : (clientData?.items ?? []);

    if (clientList.length === 0) {
      return { error: `No clients found matching "${clientName}"`, computers: [] };
    }

    if (clientList.length > 1) {
      // Ambiguous — return the matches so Claude can ask the user to be more specific
      return {
        multipleClientsFound: clientList.map((c: any) => ({ Id: c.Id, Name: c.Name })),
        message: `Found ${clientList.length} clients matching "${clientName}". Use a more specific name or pass a clientId directly to get_computers.`,
      };
    }

    const client = clientList[0];
    const data = await this.get('/Computers', `ClientId=${client.Id}`, pageSize, page, orderBy);
    const computers: any[] = Array.isArray(data) ? data : (data?.items ?? []);

    return {
      client: { Id: client.Id, Name: client.Name },
      totalReturned: computers.length,
      computers: computers.map(compactComputer),
    };
  }

  // ─── Clients ───────────────────────────────────────────────────────────────

  async getClients(
    condition?: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    return this.get('/Clients', condition, pageSize, page, orderBy);
  }

  async getClientById(id: number): Promise<any> {
    const response = await this.httpClient.get(`/Clients/${id}`);
    return response.data;
  }

  // ─── Locations ─────────────────────────────────────────────────────────────

  async getLocations(
    condition?: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    return this.get('/Locations', condition, pageSize, page, orderBy);
  }

  async getLocationById(id: number): Promise<any> {
    const response = await this.httpClient.get(`/Locations/${id}`);
    return response.data;
  }

  // ─── Groups ────────────────────────────────────────────────────────────────

  async getGroups(
    condition?: string,
    pageSize: number = 25,
    page: number = 1,
    orderBy?: string
  ): Promise<any> {
    return this.get('/Groups', condition, pageSize, page, orderBy);
  }

  async getGroupById(id: number): Promise<any> {
    const response = await this.httpClient.get(`/Groups/${id}`);
    return response.data;
  }

  // ─── Analytics helpers ─────────────────────────────────────────────────────

  /**
   * Returns aggregate counts: total, by client, by OS, and online/offline split.
   * Fetches all pages internally; returns a compact summary to avoid token overflow.
   */
  async getComputersSummary(clientId?: number): Promise<any> {
    const condition = clientId !== undefined ? `ClientId=${clientId}` : undefined;
    const computers = await this.getAllPages('/Computers', condition);

    const byClient: Record<string, number> = {};
    const byClientWorkstations: Record<string, number> = {};
    const byClientServers: Record<string, number> = {};
    const byOS: Record<string, number> = {};
    let online = 0;
    let offline = 0;

    for (const c of computers) {
      // Client name
      const clientName: string = c.Client?.Name ?? c.ClientName ?? `Client ${c.ClientId ?? 'Unknown'}`;
      byClient[clientName] = (byClient[clientName] ?? 0) + 1;

      // Type breakdown (Workstation vs Server)
      if (c.Type === 'Server') {
        byClientServers[clientName] = (byClientServers[clientName] ?? 0) + 1;
      } else {
        byClientWorkstations[clientName] = (byClientWorkstations[clientName] ?? 0) + 1;
      }

      // OS type — field is OperatingSystemName in the Automate API
      const os: string = normaliseOS(c.OperatingSystemName ?? '');
      byOS[os] = (byOS[os] ?? 0) + 1;

      // Online status — Automate returns Status as a string: "Online" or "Offline"
      const isOnline = c.Status === 'Online';
      if (isOnline) online++;
      else offline++;
    }

    return {
      totalCount: computers.length,
      online,
      offline,
      byClient,
      byClientWorkstations,
      byClientServers,
      byOS,
    };
  }

  /**
   * Returns computers that have not checked in within the last `daysOffline` days.
   * Fetches offline computers (Status='Offline') and filters by RemoteAgentLastContact
   * client-side, since the API does not support date comparisons in conditions.
   */
  async getOfflineComputers(
    daysOffline: number = 1,
    clientId?: number,
    pageSize: number = 100
  ): Promise<any[]> {
    const cutoff = new Date(Date.now() - daysOffline * 24 * 60 * 60 * 1000);

    const parts: string[] = [`Status='Offline'`];
    if (clientId !== undefined) parts.push(`ClientId=${clientId}`);
    const condition = parts.join(' AND ');

    // Fetch up to 1000 offline computers then filter by date client-side
    const data = await this.get('/Computers', condition, 1000, 1, 'RemoteAgentLastContact asc');
    const list: any[] = Array.isArray(data) ? data : (data?.items ?? []);

    return list
      .filter((c) => {
        const lastContact = c.RemoteAgentLastContact ? new Date(c.RemoteAgentLastContact) : null;
        return lastContact && lastContact < cutoff;
      })
      .slice(0, pageSize)
      .map(compactComputer);
  }

  /**
   * Check a list of computer names against Automate in bulk.
   * For each name, returns whether an agent exists, its status, last contact, and client.
   */
  async batchCheckComputers(
    names: string[]
  ): Promise<{ results: Record<string, any>; summary: { found: number; notFound: number; online: number; offline: number } }> {
    // Build an OR condition: ComputerName='name1' OR ComputerName='name2' ...
    // Automate API doesn't support OR in conditions, so we fetch all and filter client-side.
    // To keep it efficient, fetch computers matching any of the names using multiple calls if needed.
    const results: Record<string, any> = {};
    const notFoundNames = new Set(names.map(n => n.toUpperCase()));

    // Batch into groups of 10 names for parallel API calls
    const batchSize = 10;
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      const promises = batch.map(async (name) => {
        try {
          const data = await this.get('/Computers', `ComputerName='${name}'`, 5);
          const list: any[] = Array.isArray(data) ? data : (data?.items ?? []);
          if (list.length > 0) {
            const c = list[0];
            notFoundNames.delete(name.toUpperCase());
            results[name] = {
              found: true,
              computerId: c.Id,
              computerName: c.ComputerName,
              status: c.Status,
              lastContact: c.RemoteAgentLastContact,
              client: c.Client?.Name ?? `Client ${c.ClientId ?? 'Unknown'}`,
              type: c.Type,
              os: c.OperatingSystemName ?? '',
            };
          } else {
            results[name] = { found: false };
          }
        } catch {
          results[name] = { found: false, error: 'lookup failed' };
        }
      });
      await Promise.all(promises);
    }

    // Fill in any names not yet in results
    for (const name of names) {
      if (!results[name]) {
        results[name] = { found: false };
      }
    }

    const found = Object.values(results).filter((r: any) => r.found).length;
    const online = Object.values(results).filter((r: any) => r.found && r.status === 'Online').length;

    return {
      results,
      summary: {
        found,
        notFound: names.length - found,
        online,
        offline: found - online,
      },
    };
  }

  /**
   * Find computers whose agent has not checked in for more than `daysOld` days.
   * Similar to getOfflineComputers but with a longer default horizon (30 days) and
   * an optional type filter — useful for identifying truly dead/retired agents.
   */
  async getStaleComputers(
    daysOld: number = 30,
    clientId?: number,
    typeFilter?: string,
    pageSize: number = 100
  ): Promise<any[]> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const parts: string[] = [`Status='Offline'`];
    if (clientId !== undefined) parts.push(`ClientId=${clientId}`);
    if (typeFilter) parts.push(`Type='${typeFilter}'`);
    const condition = parts.join(' AND ');

    // Fetch up to 2000 offline computers then filter by date client-side
    const data = await this.get('/Computers', condition, 2000, 1, 'RemoteAgentLastContact asc');
    const list: any[] = Array.isArray(data) ? data : (data?.items ?? []);

    return list
      .filter((c) => {
        const lastContact = c.RemoteAgentLastContact ? new Date(c.RemoteAgentLastContact) : null;
        return lastContact && lastContact < cutoff;
      })
      .slice(0, pageSize)
      .map(compactComputer);
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Whitelist of fields requested for regular computer list queries via options.includedFields.
 * Keeps analytically useful fields and drops everything else, reducing per-record size
 * from ~60+ fields down to ~20. get_computer (single record) always returns all fields.
 */
const COMPACT_FIELDS = [
  'Id', 'ComputerName', 'Client', 'Location', 'Type',
  'OperatingSystemName', 'Status', 'RemoteAgentLastContact',
  'LastUserName', 'LoggedInUsers', 'LocalIPAddress', 'Comment',
  'IsRebootNeeded', 'IsVirtualMachine', 'IsMaintenanceModeEnabled',
  'TotalMemory', 'FreeMemory', 'CpuUsage', 'LastHeartbeat',
  'SerialNumber', 'AssetTag', 'VirusScanner', 'IsHeartbeatRunning',
];

/**
 * Minimal fields needed for getComputersSummary aggregation.
 * Reduces each record to just 3 fields when fetching thousands of computers.
 */
const SUMMARY_FIELDS = ['Client', 'Status', 'OperatingSystemName'];

/**
 * Client-side fallback — mirrors COMPACT_FIELDS as a whitelist.
 * Applied after server response in case options.includedFields is not honoured.
 */
function compactComputer(c: any): any {
  const keep = new Set(COMPACT_FIELDS);
  return Object.fromEntries(Object.entries(c).filter(([k]) => keep.has(k)));
}

function normaliseOS(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('windows 11')) return 'Windows 11';
  if (s.includes('windows 10')) return 'Windows 10';
  if (s.includes('windows server 2022')) return 'Windows Server 2022';
  if (s.includes('windows server 2019')) return 'Windows Server 2019';
  if (s.includes('windows server 2016')) return 'Windows Server 2016';
  if (s.includes('windows server 2012')) return 'Windows Server 2012';
  if (s.includes('windows server')) return 'Windows Server (other)';
  if (s.includes('windows')) return 'Windows (other)';
  if (s.includes('mac') || s.includes('darwin')) return 'macOS';
  if (s.includes('linux') || s.includes('ubuntu') || s.includes('debian') || s.includes('centos') || s.includes('rhel')) return 'Linux';
  if (s === '') return 'Unknown';
  return raw;
}
