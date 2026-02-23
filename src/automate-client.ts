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
    orderBy?: string
  ): Promise<any> {
    return this.get('/Computers', condition, pageSize, page, orderBy);
  }

  async getComputerById(id: number): Promise<any> {
    const response = await this.httpClient.get(`/Computers/${id}`);
    return response.data;
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
    const byOS: Record<string, number> = {};
    let online = 0;
    let offline = 0;

    for (const c of computers) {
      // Client name
      const clientName: string = c.Client?.Name ?? c.ClientName ?? `Client ${c.ClientId ?? 'Unknown'}`;
      byClient[clientName] = (byClient[clientName] ?? 0) + 1;

      // OS type — normalise to a short label
      const os: string = normaliseOS(c.OperatingSystem ?? c.OS ?? '');
      byOS[os] = (byOS[os] ?? 0) + 1;

      // Online status — Automate exposes Status: 1 = online, or IsOnline boolean
      const isOnline =
        c.Status === 1 ||
        c.IsOnline === true ||
        c.ComputerStatus === 'Online';
      if (isOnline) online++;
      else offline++;
    }

    return {
      totalCount: computers.length,
      online,
      offline,
      byClient,
      byOS,
    };
  }

  /**
   * Returns computers that haven't checked in within the last `daysOffline` days.
   */
  async getOfflineComputers(
    daysOffline: number = 1,
    clientId?: number,
    pageSize: number = 100
  ): Promise<any[]> {
    const cutoff = new Date(Date.now() - daysOffline * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().replace('T', ' ').substring(0, 19);

    const parts: string[] = [`LastContact<'${cutoffStr}'`];
    if (clientId !== undefined) parts.push(`ClientId=${clientId}`);
    const condition = parts.join(' AND ');

    return this.get('/Computers', condition, pageSize, 1, 'LastContact asc');
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

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
