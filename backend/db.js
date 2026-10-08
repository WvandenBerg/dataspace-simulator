/**
 * db.js — SQLite persistence for the local Dataspace Simulator
 *
 * Single-user local tool — no sessions, no BPN network identities,
 * no heartbeat. Everything is simple CRUD.
 *
 * Concepts:
 *   Node    — a visualized participant (name, position on canvas, metadata)
 *   Asset   — data asset published by a node
 *   Policy  — access constraint template attached to an asset
 *   Negotiation — contract negotiation state machine record
 *   Transfer    — data transfer record
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/simulator.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// Read before the schema below creates the tables.
const isNewDatabase = !db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nodes'`).get();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    node_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    metadata   TEXT NOT NULL DEFAULT '{}'
    -- metadata JSON: { location, domain, ontologies, dataCategories, formats,
    --                  tags, roles: { provider, consumer }, dspEndpoint }
  );

  CREATE TABLE IF NOT EXISTS assets (
    asset_id     TEXT PRIMARY KEY,
    dataspace_id TEXT NOT NULL DEFAULT 'demo',
    owner_node_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    asset_content TEXT NOT NULL DEFAULT '',
    file_name    TEXT NOT NULL DEFAULT '',
    policy_id    TEXT,
    dcat_fields  TEXT NOT NULL DEFAULT '{}',
    published_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policies (
    policy_id          TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    constraint_operand TEXT NOT NULL DEFAULT 'And',
    constraints        TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS negotiations (
    negotiation_id   TEXT PRIMARY KEY,
    consumer_node_id TEXT NOT NULL,
    provider_node_id TEXT NOT NULL,
    asset_id         TEXT NOT NULL,
    policy_id        TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'REQUESTED',
    denial_reason    TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transfers (
    transfer_id      TEXT PRIMARY KEY,
    negotiation_id   TEXT NOT NULL,
    consumer_node_id TEXT NOT NULL,
    provider_node_id TEXT NOT NULL,
    asset_id         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'STARTED',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS received_data (
    record_id        TEXT PRIMARY KEY,
    receiver_node_id TEXT NOT NULL,
    provider_node_id TEXT NOT NULL,
    asset_id         TEXT NOT NULL,
    asset_name       TEXT NOT NULL,
    asset_content    TEXT NOT NULL DEFAULT '',
    transfer_id      TEXT NOT NULL,
    received_at      TEXT NOT NULL
  );

  -- scenario_id is the scenario the dataspace was created from, or NULL for an empty one.
  CREATE TABLE IF NOT EXISTS dataspaces (
    dataspace_id TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    scenario_id  TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dataspace_settings (
    dataspace_id TEXT PRIMARY KEY,
    settings     TEXT NOT NULL DEFAULT '{}'
  );

  -- Profiles a hub learned from files rather than from a catalogue export.
  -- title is null when the files attach to a profile the export already describes.
  CREATE TABLE IF NOT EXISTS hub_profiles (
    dataspace_id TEXT NOT NULL,
    profile_id   TEXT NOT NULL,
    title        TEXT,
    version      TEXT,
    description  TEXT,
    source       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (dataspace_id, profile_id)
  );

  CREATE TABLE IF NOT EXISTS hub_artifacts (
    dataspace_id TEXT NOT NULL,
    artifact_id  TEXT NOT NULL,
    profile_id   TEXT NOT NULL,
    role         TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    media_type   TEXT NOT NULL,
    content      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (dataspace_id, artifact_id)
  );
`);

function ensureColumn(tableName, columnName, definitionSql) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = cols.some((c) => c.name === columnName);
  if (!exists) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
}

ensureColumn('assets', 'asset_content', "TEXT NOT NULL DEFAULT ''");
ensureColumn('received_data', 'asset_content', "TEXT NOT NULL DEFAULT ''");
ensureColumn('assets', 'dataspace_id', "TEXT NOT NULL DEFAULT 'demo'");
// JSON array of property IRIs, or JSON null once someone chose dct:conformsTo; SQL NULL means never set.
ensureColumn('hub_profiles', 'data_standard_path', 'TEXT');

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const _upsertNode = db.prepare(`
  INSERT OR REPLACE INTO nodes (node_id, name, x, y, metadata)
  VALUES (@node_id, @name, @x, @y, @metadata)
`);
const _getNode = db.prepare(`SELECT * FROM nodes WHERE node_id = ?`);
const _getAllNodes = db.prepare(`SELECT * FROM nodes ORDER BY name`);
const _deleteNode = db.prepare(`DELETE FROM nodes WHERE node_id = ?`);
const _updatePos = db.prepare(`UPDATE nodes SET x = ?, y = ? WHERE node_id = ?`);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const _insertAsset = db.prepare(`
  INSERT OR REPLACE INTO assets
    (asset_id, dataspace_id, owner_node_id, name, description, asset_content, file_name, policy_id, dcat_fields, published_at)
  VALUES
    (@asset_id, @dataspace_id, @owner_node_id, @name, @description, @asset_content, @file_name, @policy_id, @dcat_fields, @published_at)
`);
const _getAsset = db.prepare(`SELECT * FROM assets WHERE asset_id = ?`);
const _getAssetsByNode = db.prepare(`SELECT * FROM assets WHERE owner_node_id = ? ORDER BY published_at DESC`);
const _getAllAssets = db.prepare(`SELECT * FROM assets ORDER BY published_at DESC`);
const _updateAsset = db.prepare(`
  UPDATE assets
  SET name = @name,
      dataspace_id = @dataspace_id,
      description = @description,
      asset_content = @asset_content,
      file_name = @file_name,
      policy_id = @policy_id,
      dcat_fields = @dcat_fields
  WHERE asset_id = @asset_id
`);
const _deleteAsset = db.prepare(`DELETE FROM assets WHERE asset_id = ?`);
const _deleteAssetsByNode = db.prepare(`DELETE FROM assets WHERE owner_node_id = ?`);

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const _upsertPolicy = db.prepare(`
  INSERT OR REPLACE INTO policies (policy_id, name, constraint_operand, constraints)
  VALUES (@policy_id, @name, @constraint_operand, @constraints)
`);
const _getPolicy = db.prepare(`SELECT * FROM policies WHERE policy_id = ?`);
const _getAllPolicies = db.prepare(`SELECT * FROM policies ORDER BY name`);
const _deletePolicy = db.prepare(`DELETE FROM policies WHERE policy_id = ?`);

// ---------------------------------------------------------------------------
// Negotiations
// ---------------------------------------------------------------------------

const _insertNeg = db.prepare(`
  INSERT INTO negotiations
    (negotiation_id, consumer_node_id, provider_node_id, asset_id,
     policy_id, status, denial_reason, created_at, updated_at)
  VALUES
    (@negotiation_id, @consumer_node_id, @provider_node_id, @asset_id,
     @policy_id, @status, @denial_reason, @created_at, @updated_at)
`);
const _getNeg = db.prepare(`SELECT * FROM negotiations WHERE negotiation_id = ?`);
const _getNegsByConsumer = db.prepare(`
  SELECT * FROM negotiations WHERE consumer_node_id = ? ORDER BY created_at DESC
`);
const _updateNegStatus = db.prepare(`
  UPDATE negotiations SET status = ?, denial_reason = ?, updated_at = ? WHERE negotiation_id = ?
`);

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const _insertTransfer = db.prepare(`
  INSERT INTO transfers
    (transfer_id, negotiation_id, consumer_node_id, provider_node_id, asset_id, status, created_at, updated_at)
  VALUES
    (@transfer_id, @negotiation_id, @consumer_node_id, @provider_node_id, @asset_id, @status, @created_at, @updated_at)
`);
const _getTransfer = db.prepare(`SELECT * FROM transfers WHERE transfer_id = ?`);
const _updateTransferStatus = db.prepare(`
  UPDATE transfers SET status = ?, updated_at = ? WHERE transfer_id = ?
`);

// ---------------------------------------------------------------------------
// Received data
// ---------------------------------------------------------------------------

const _insertReceived = db.prepare(`
  INSERT OR REPLACE INTO received_data
    (record_id, receiver_node_id, provider_node_id, asset_id, asset_name, asset_content, transfer_id, received_at)
  VALUES
    (@record_id, @receiver_node_id, @provider_node_id, @asset_id, @asset_name, @asset_content, @transfer_id, @received_at)
`);
const _getReceivedByNode = db.prepare(`
  SELECT * FROM received_data WHERE receiver_node_id = ? ORDER BY received_at DESC
`);

// ---------------------------------------------------------------------------
// Dataspaces
// ---------------------------------------------------------------------------

const _insertDataspace = db.prepare(`
  INSERT INTO dataspaces (dataspace_id, name, scenario_id, created_at)
  VALUES (@dataspace_id, @name, @scenario_id, @created_at)
`);
const _getDataspace = db.prepare(`SELECT * FROM dataspaces WHERE dataspace_id = ?`);
const _getAllDataspaces = db.prepare(`SELECT * FROM dataspaces ORDER BY created_at, name`);
const _renameDataspace = db.prepare(`UPDATE dataspaces SET name = ? WHERE dataspace_id = ?`);
const _getConfiguredDataspaceIds = db.prepare(`
  SELECT dataspace_id FROM dataspace_settings UNION SELECT dataspace_id FROM hub_profiles
`);

// ---------------------------------------------------------------------------
// Dataspace settings
// ---------------------------------------------------------------------------

const _getSettings = db.prepare(`SELECT settings FROM dataspace_settings WHERE dataspace_id = ?`);
const _putSettings = db.prepare(`
  INSERT OR REPLACE INTO dataspace_settings (dataspace_id, settings) VALUES (?, ?)
`);

function getDataspaceSettings(dataspaceId) {
  const row = _getSettings.get(dataspaceId);
  return row ? parseJson(row.settings) : {};
}

// Each top-level section is merged, so patching one field of vocabHub keeps the others.
function patchDataspaceSettings(dataspaceId, patch) {
  const current = getDataspaceSettings(dataspaceId);
  const next = { ...current };
  for (const [section, values] of Object.entries(patch)) {
    next[section] = { ...(current[section] || {}), ...values };
  }
  _putSettings.run(dataspaceId, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------
// Hub profiles and their files
// ---------------------------------------------------------------------------

const _upsertHubProfile = db.prepare(`
  INSERT OR REPLACE INTO hub_profiles (dataspace_id, profile_id, title, version, description, source, created_at, data_standard_path)
  VALUES (@dataspace_id, @profile_id, @title, @version, @description, @source, @created_at, @data_standard_path)
`);
const _setHubProfileDataStandard = db.prepare(`
  UPDATE hub_profiles SET data_standard_path = ? WHERE dataspace_id = ? AND profile_id = ?
`);
const _getHubProfiles = db.prepare(`SELECT * FROM hub_profiles WHERE dataspace_id = ? ORDER BY created_at`);
const _getHubProfile = db.prepare(`SELECT * FROM hub_profiles WHERE dataspace_id = ? AND profile_id = ?`);
const _deleteHubProfile = db.prepare(`DELETE FROM hub_profiles WHERE dataspace_id = ? AND profile_id = ?`);
const _insertHubArtifact = db.prepare(`
  INSERT OR REPLACE INTO hub_artifacts
    (dataspace_id, artifact_id, profile_id, role, file_name, media_type, content, created_at)
  VALUES
    (@dataspace_id, @artifact_id, @profile_id, @role, @file_name, @media_type, @content, @created_at)
`);
const _getHubArtifacts = db.prepare(`
  SELECT dataspace_id, artifact_id, profile_id, role, file_name, media_type, created_at
  FROM hub_artifacts WHERE dataspace_id = ? ORDER BY created_at, file_name
`);
const _getHubArtifact = db.prepare(`SELECT * FROM hub_artifacts WHERE dataspace_id = ? AND artifact_id = ?`);
const _deleteHubArtifacts = db.prepare(`DELETE FROM hub_artifacts WHERE dataspace_id = ? AND profile_id = ?`);

const removeHubProfile = db.transaction((dataspaceId, profileId) => {
  _deleteHubArtifacts.run(dataspaceId, profileId);
  _deleteHubProfile.run(dataspaceId, profileId);
});

const saveHubProfile = db.transaction((profile, artifacts) => {
  _upsertHubProfile.run(profile);
  for (const artifact of artifacts) _insertHubArtifact.run(artifact);
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function parseJson(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function enrichNode(row) {
  if (!row) return null;
  return { ...row, metadata: parseJson(row.metadata) };
}
function enrichAsset(row) {
  if (!row) return null;
  return { ...row, dcat_fields: parseJson(row.dcat_fields) };
}
function enrichPolicy(row) {
  if (!row) return null;
  return { ...row, constraints: parseJson(row.constraints, []) };
}

module.exports = {
  isNewDatabase,

  // Dataspaces
  insertDataspace: (d) => _insertDataspace.run(d),
  getDataspace: (id) => _getDataspace.get(id) || null,
  getAllDataspaces: () => _getAllDataspaces.all(),
  renameDataspace: (id, name) => _renameDataspace.run(name, id),
  getConfiguredDataspaceIds: () => _getConfiguredDataspaceIds.all().map((r) => r.dataspace_id),

  // Dataspace settings
  getDataspaceSettings,
  patchDataspaceSettings,

  // Hub profiles and their files
  saveHubProfile,
  removeHubProfile,
  getHubProfiles: (dataspaceId) => _getHubProfiles.all(dataspaceId),
  getHubProfile: (dataspaceId, profileId) => _getHubProfile.get(dataspaceId, profileId) || null,
  setHubProfileDataStandard: (dataspaceId, profileId, path) => _setHubProfileDataStandard.run(JSON.stringify(path ?? null), dataspaceId, profileId),
  getHubArtifacts: (dataspaceId) => _getHubArtifacts.all(dataspaceId),
  getHubArtifact: (dataspaceId, artifactId) => _getHubArtifact.get(dataspaceId, artifactId) || null,

  // Nodes
  upsertNode: (n) => _upsertNode.run({ ...n, metadata: JSON.stringify(n.metadata || {}) }),
  getNode: (id) => enrichNode(_getNode.get(id)),
  getAllNodes: () => _getAllNodes.all().map(enrichNode),
  deleteNode: (id) => _deleteNode.run(id),
  updateNodePosition: (id, x, y) => _updatePos.run(x, y, id),

  // Assets
  insertAsset: (a) => _insertAsset.run({ ...a, dcat_fields: JSON.stringify(a.dcat_fields || {}) }),
  getAsset: (id) => enrichAsset(_getAsset.get(id)),
  getAssetsByNode: (nodeId) => _getAssetsByNode.all(nodeId).map(enrichAsset),
  getAllAssets: () => _getAllAssets.all().map(enrichAsset),
  updateAsset: (a) => _updateAsset.run({ ...a, dcat_fields: JSON.stringify(a.dcat_fields || {}) }),
  deleteAsset: (id) => _deleteAsset.run(id),
  deleteAssetsByNode: (nodeId) => _deleteAssetsByNode.run(nodeId),

  // Policies
  upsertPolicy: (p) => _upsertPolicy.run({ ...p, constraints: JSON.stringify(p.constraints || []) }),
  getPolicy: (id) => enrichPolicy(_getPolicy.get(id)),
  getAllPolicies: () => _getAllPolicies.all().map(enrichPolicy),
  deletePolicy: (id) => _deletePolicy.run(id),

  // Negotiations
  insertNegotiation: (n) => _insertNeg.run(n),
  getNegotiation: (id) => _getNeg.get(id),
  getNegotiationsByConsumer: (nodeId) => _getNegsByConsumer.all(nodeId),
  updateNegotiationStatus: (id, status, reason, ts) =>
    _updateNegStatus.run(status, reason || null, ts, id),

  // Transfers
  insertTransfer: (t) => _insertTransfer.run(t),
  getTransfer: (id) => _getTransfer.get(id),
  updateTransferStatus: (id, status, ts) => _updateTransferStatus.run(status, ts, id),

  // Received data
  insertReceivedData: (r) => _insertReceived.run(r),
  getReceivedDataByNode: (nodeId) => _getReceivedByNode.all(nodeId),
};
