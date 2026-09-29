const {getSnapshot, credentialDiagnostics, configured, healthProbe} = require('../lib/server.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');

  const diagnostics = credentialDiagnostics();
  if (!diagnostics.configured) {
    return res.status(200).json({
      ok: true,
      agent: 'noc-sync-agent',
      healthy: false,
      configured: false,
      syncState: 'AUTH_REQUIRED',
      diagnostics
    });
  }

  try {
    const force = String(req?.query?.refresh || '') === '1';
    const snapshot = await getSnapshot({force});
    return res.status(200).json({
      ok: true,
      agent: 'noc-sync-agent',
      healthy: true,
      configured: true,
      syncState: 'SYNCED',
      diagnostics: {
        ...diagnostics,
        googleSheetsApi: 'reachable',
        source: 'direct'
      },
      report: {
        version: snapshot.version,
        databaseRows: snapshot.diagnostics.databaseRows,
        pending: snapshot.pendingCount,
        restored: snapshot.restoredCount,
        napDownRows: snapshot.napDownSheetCount,
        formulaErrors: snapshot.diagnostics.formulaErrors,
        checkedAt: snapshot.checkedAt
      }
    });
  } catch (error) {
    const info = error?.noc || {
      code: error?.code || 'SOURCE_ERROR',
      status: error?.response?.status || null,
      message: String(error?.message || error)
    };

    return res.status(200).json({
      ok: true,
      agent: 'noc-sync-agent',
      healthy: false,
      configured: configured(),
      syncState: 'SOURCE_ERROR',
      diagnostics: {
        ...diagnostics,
        googleSheetsApi: 'unreachable',
        ...info
      }
    });
  }
};
