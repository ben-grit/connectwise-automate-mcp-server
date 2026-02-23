# ConnectWise Automate API Notes

## Auth
- POST `/cwa/api/v1/apitoken` with `{ UserName, Password }` → `{ AccessToken }`
- All requests need `Authorization: Bearer {token}` AND `clientId` header (same clientId as PSA)
- Token expiry ~1 hour

## Query Parameters
The spec uses namespaced params (`options.condition`, `options.pageSize`, etc.) but the API
also accepts the shorthand flat form (`condition`, `pageSize`, `page`, `orderBy`).

Useful params on list endpoints:
- `condition` — SQL-like filter e.g. `Status='Offline'`, `Type='Server'`, `ClientId=5`
- `pageSize` / `page` — pagination
- `orderBy` — e.g. `RemoteAgentLastContact asc`
- `options.includedFields` — array of field names to include (server-side projection)
- `options.excludedFields` — array of field names to exclude

## Known Condition Field Quirks
- `Status='Offline'` ✅ works
- `Type='Server'` ✅ works (values: Workstation, Server)
- `ClientId=5` ✅ works
- `RemoteAgentLastContact<'...'` ❌ 500 error — date comparisons not supported
- `LastContact<'...'` ❌ 400 "Invalid field" — field doesn't exist in conditions

Workaround: filter by `Status='Offline'` then filter by `RemoteAgentLastContact` client-side.

## Key Endpoints

### Computers
- `GET /Computers` — list/search computers (LabTech.Models.Computer schema)
- `GET /Computers/{id}` — single computer detail
- `GET /Computers/Drives` — drives across ALL computers (filterable); fields include `FreeSpace`, `Size`, `SmartStatus`, `IsSolidState`
- `GET /Computers/{id}/PatchingStats` — patch compliance: `OverallCompliance`, `MissingPatchCount`, `FailedPatchCount`, `LastPatchedDate`
- `GET /Computers/{id}/MicrosoftUpdates` — individual missing/installed patches
- `GET /Computers/{id}/ThirdPartyPatches` — third-party patch compliance
- `GET /Computers/{id}/Software` — installed software (`Name`, `Version`, `DateInstalled`)
- `GET /Computers/{id}/Services` — Windows services (`Name`, `State`, `Startup`)
- `GET /Computers/{id}/Monitors` — assigned monitors and their state
- `GET /Computers/{id}/Alerts` — alerts for a specific computer
- `GET /Computers/{id}/Drives/{driveId}/SmartData` — SMART disk health data
- `GET /Computers/{id}/OperatingSystem` — detailed OS info
- `GET /Computers/{id}/Processors` — CPU details
- `GET /Computers/{id}/Sensors` — sensor readings

### Alerts (global)
- `GET /Alerts` — all alerts across environment (filterable)
- `GET /Alerts/{alertId}` — single alert detail

### Other
- `GET /Locations/{id}` — location detail + extra fields
- `GET /RetiredAssets` — retired asset records
- `GET /VirusScannerDefs` — AV definition info

## Computer Schema Fields (LabTech.Models.Computer)
Valid for `orderBy` (and possibly `includedFields`/`excludedFields`):
Id, ComputerName, OperatingSystemName, OperatingSystemVersion, Status, Type,
RemoteAgentLastContact, RemoteAgentLastInventory, LastHeartbeat, LastInventoryReceived,
TotalMemory, FreeMemory, CpuUsage, LocalIPAddress, MACAddress, DomainName,
IsRebootNeeded, IsVirtualMachine, IsMaintenanceModeEnabled, IsHeartbeatRunning,
LastUserName, LoggedInUsers, Comment, SerialNumber, AssetTag, WarrantyEndDate,
VirusScanner, BiosManufacturer, Location (nested), Client (nested)

Heavy array fields to exclude: OpenPortsTCP, OpenPortsUDP, IRQ, Address, DMA,
UserAccounts, PowerProfiles, HardwarePorts, Groups, Tickets

## Future Tool Ideas
- `get_drives` — low disk space detection using `/Computers/Drives` with `FreeSpace` filter
- `get_patch_status` — per-computer or summary patch compliance
- `get_alerts` — current alerts across the environment
- `get_software` — installed software on a specific computer
- `get_stale_computers` (enhanced) — use `options.includedFields` to cut response size
