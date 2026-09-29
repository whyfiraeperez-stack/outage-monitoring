const {getSnapshot} = require('../lib/server.cjs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const force = String(req?.query?.refresh || '') === '1';
    const snapshot = await getSnapshot({force});
    res.statusCode = 200;
    res.setHeader('X-NOC-Source', 'google-sheets-api');
    res.setHeader('X-NOC-Version', snapshot.version);
    return res.json(snapshot);
  } catch (error) {
    const diagnostics = error?.noc || {
      code: error?.code || 'SOURCE_ERROR',
      status: error?.response?.status || null,
      message: String(error?.message || error)
    };

    const response = {
      ok: false,
      syncState: 'SOURCE_ERROR',
      sourceMode: 'none',
      checkedAt: new Date().toISOString(),
      diagnostics,
      nextAction: diagnostics.code === 'SHEET_ACCESS_DENIED'
        ? 'Share the spreadsheet with the service-account email shown in the dashboard.'
        : diagnostics.code === 'SHEETS_API_DISABLED'
        ? 'Enable Google Sheets API for the service-account Google Cloud project.'
        : diagnostics.code === 'SHEET_NOT_FOUND'
        ? 'Verify the spreadsheet ID and sheet IDs.'
        : diagnostics.code === 'GOOGLE_AUTH_FAILED'
        ? 'Replace the Production Google service-account credential and redeploy.'
        : 'Review the exact source error and retry.'
    };

    res.statusCode = diagnostics.code === 'MISSING_CREDENTIAL' || diagnostics.code === 'INVALID_CREDENTIAL' ? 200 : 503;
    return res.json(response);
  }
};
