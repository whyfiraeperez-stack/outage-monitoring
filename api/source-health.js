const {credentialDiagnostics, CFG, healthProbe} = require('../lib/server.cjs');

module.exports = async (_req, res) => {
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  try {
    const credential = credentialDiagnostics();
    let sheet = {reachable:false};
    let sheetError = null;
    if (credential.configured) {
      try {
        sheet = await healthProbe();
      } catch (error) {
        sheetError = {
          code: error?.code || error?.response?.status || 'GOOGLE_API_ERROR',
          status: error?.response?.status || null,
          message: String(error?.message || error)
        };
      }
    }
    res.statusCode = 200;
    return res.json({
      ok: !!(credential.configured && sheet.reachable),
      agent: 'LIVE SOURCE AGENT',
      checkedAt: new Date().toISOString(),
      spreadsheetId: CFG.sheetId,
      databaseGid: CFG.dbGid,
      napDownGid: CFG.napGid,
      credential: {
        configured: credential.configured,
        source: credential.source,
        clientEmail: credential.clientEmail || null,
        projectId: credential.projectId || null,
        error: credential.error || null
      },
      sheet,
      sheetError
    });
  } catch (error) {
    res.statusCode = 200;
    return res.json({
      ok:false,
      agent:'LIVE SOURCE AGENT',
      checkedAt:new Date().toISOString(),
      error:String(error?.message || error)
    });
  }
};
