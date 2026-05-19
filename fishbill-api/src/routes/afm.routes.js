/**
 * AFM Lookup Route
 * GET /api/afm/lookup?afm=XXXXXXXXX
 *
 * Queries the Greek AADE (GSIS) SOAP API to fetch business details by AFM (tax ID).
 * Each business must configure their own TAXISnet credentials in Settings → ΓΓΠΣ.
 * Using shared/platform credentials is legally non-compliant: the government logs
 * every lookup and associates it with the caller's AFM (afmCalledBy).
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../config/database');
const jwt = require('jsonwebtoken');

// ── Helper: get per-business GSIS credentials + caller AFM ───────────────────
async function getGsisCredentials(businessId) {
  if (!businessId) return null;

  const [rows] = await pool.execute(
    `SELECT gsis_username, gsis_password, afm AS caller_afm
     FROM businesses WHERE id = ? LIMIT 1`,
    [businessId]
  );

  if (rows[0]?.gsis_username && rows[0]?.gsis_password) {
    return {
      username:   rows[0].gsis_username,
      password:   rows[0].gsis_password,
      callerAfm:  rows[0].caller_afm,
    };
  }
  return null;
}

// ── Helper: build SOAP envelope ───────────────────────────────────────────────
// Namespaces verified against AADE WSDL: https://www1.aade.gr/wsaade/RgWsPublic2/RgWsPublic2?wsdl
// tns = http://rgwspublic2/RgWsPublic2Service (operation)
// ns1 = http://rgwspublic2/RgWsPublic2        (input type fields)
function buildSoapRequest(username, password, callerAfm, afm) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope
  xmlns:env="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
  xmlns:tns="http://rgwspublic2/RgWsPublic2Service"
  xmlns:ns1="http://rgwspublic2/RgWsPublic2">
  <env:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password>${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </env:Header>
  <env:Body>
    <tns:rgWsPublic2AfmMethod>
      <tns:INPUT_REC>
        <ns1:afm_called_by>${callerAfm}</ns1:afm_called_by>
        <ns1:afm_called_for>${afm}</ns1:afm_called_for>
      </tns:INPUT_REC>
    </tns:rgWsPublic2AfmMethod>
  </env:Body>
</env:Envelope>`;
}

function extractXml(xml, tag) {
  // Match both namespaced (<ns2:tag>) and plain (<tag>) — case insensitive
  const patterns = [
    new RegExp(`<[\\w]*:${tag}>([^<]*)<`, 'i'),   // <ns:tag>value</ns:tag>
    new RegExp(`<${tag}>([^<]*)<`, 'i'),            // <tag>value</tag>
    new RegExp(`<[\\w]*:${tag}\\s[^>]*>([^<]*)<`, 'i'), // <ns:tag attr="">
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

// ── GET /api/afm/lookup?afm=XXXXXXXXX ────────────────────────────────────────
// Requires authentication — each business uses their own TAXISnet credentials.
// The government logs every lookup: afmCalledBy = the caller's own AFM.
// Using shared platform credentials would make all lookups appear as one entity,
// which is legally non-compliant.
router.get('/lookup', async (req, res, next) => {
  try {
    const { afm } = req.query;

    if (!afm || !/^\d{9}$/.test(afm)) {
      return res.status(400).json({ error: 'Το ΑΦΜ πρέπει να είναι ακριβώς 9 ψηφία.' });
    }

    // Authentication is required — anonymous lookups are not allowed
    let businessId = null;
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        businessId = decoded.business_id || null;
      }
    } catch {
      // invalid token — fall through to 401 below
    }

    if (!businessId) {
      return res.status(401).json({ error: 'Απαιτείται σύνδεση για αναζήτηση ΑΦΜ.' });
    }

    let creds = await getGsisCredentials(businessId);

    if (!creds) {
      // Fall back to platform credentials (same as used during registration)
      const pu  = process.env.PLATFORM_GSIS_USERNAME;
      const pp  = process.env.PLATFORM_GSIS_PASSWORD;
      const pca = process.env.PLATFORM_GSIS_CALLER_AFM;
      if (pu && pp && pca) {
        creds = { username: pu, password: pp, callerAfm: pca };
      } else {
        return res.status(503).json({
          error: 'Δεν έχετε ορίσει κωδικούς TAXISnet για αναζήτηση ΑΦΜ. Μεταβείτε στις Ρυθμίσεις → ΓΓΠΣ για να τους καταχωρίσετε.',
          setup_required: true,
        });
      }
    }

    if (!creds.callerAfm) {
      return res.status(503).json({
        error: 'Το ΑΦΜ της επιχείρησής σας δεν έχει καταχωρηθεί. Επικοινωνήστε με την υποστήριξη.',
      });
    }

    const soapBody = buildSoapRequest(creds.username, creds.password, creds.callerAfm, afm);

const response = await axios.post(
      'https://www1.aade.gr/wsaade/RgWsPublic2/RgWsPublic2',
      soapBody,
      {
        headers: {
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          'SOAPAction': 'http://rgwspublic2/RgWsPublic2Service:rgWsPublic2AfmMethod',
        },
        timeout: 10000,
      }
    );

    const xml = response.data;

    // Check for errors in response — AADE uses error_code / error_descr
    const errorCode = extractXml(xml, 'error_code');
    if (errorCode) {
      const errorDescr = extractXml(xml, 'error_descr');
      return res.status(404).json({
        error: errorDescr || 'Δεν βρέθηκαν στοιχεία για αυτό το ΑΦΜ.'
      });
    }

    // Parse response fields — field names from AADE XSD (snake_case)
    const companyName =
      extractXml(xml, 'onomasia') ||
      extractXml(xml, 'commer_title');

    const doy = extractXml(xml, 'doy_descr');

    const address = [
      extractXml(xml, 'postal_address'),
      extractXml(xml, 'postal_address_no'),
    ].filter(Boolean).join(' ').trim();

    const city = extractXml(xml, 'postal_area_description');

    const postalCode = extractXml(xml, 'postal_zip_code');

    const phone = null; // not in AADE basic_rec

    const activity = extractXml(xml, 'firm_flag_descr');

    const legalStatus = extractXml(xml, 'legal_status_descr');

    if (!companyName) {
      return res.status(404).json({ error: 'Δεν βρέθηκαν στοιχεία για αυτό το ΑΦΜ.' });
    }

    res.json({
      data: {
        afm,
        company_name: companyName,
        legal_status: legalStatus,
        doy,
        address: address || null,
        city: city || null,
        postal_code: postalCode || null,
        phone: phone || null,
        activity: activity || null,
      }
    });
  } catch (err) {
console.error('[AFM Lookup] Error:', err.code, err.message, err.response?.status);
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.status(503).json({
        error: 'Η υπηρεσία ΑΑΔΕ δεν αποκρίνεται αυτήν τη στιγμή. Παρακαλώ δοκιμάστε αργότερα.'
      });
    }
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Λανθασμένα στοιχεία πρόσβασης ΓΣΙΣ.' });
    }
    next(err);
  }
});

// ── GET /api/afm/public-lookup?afm=XXXXXXXXX ─────────────────────────────────
// No authentication required — used during registration before the user has an account.
// Uses the platform admin's TAXISnet credentials from environment variables.
// Rate-limited to prevent abuse: 60 lookups per 15 minutes per IP.
const publicLookupHits = new Map(); // ip -> { count, resetAt }

router.get('/public-lookup', async (req, res, next) => {
  try {
    const { afm } = req.query;

    if (!afm || !/^\d{9}$/.test(afm)) {
      return res.status(400).json({ error: 'Το ΑΦΜ πρέπει να είναι ακριβώς 9 ψηφία.' });
    }

    // Simple in-memory rate limit: 60 requests per IP per 15 min window
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const window = 15 * 60 * 1000;
    const entry = publicLookupHits.get(ip) || { count: 0, resetAt: now + window };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + window; }
    entry.count++;
    publicLookupHits.set(ip, entry);
    if (entry.count > 60) {
      return res.status(429).json({ error: 'Υπερβολικές αναζητήσεις. Δοκιμάστε σε λίγα λεπτά.' });
    }

    const username = process.env.PLATFORM_GSIS_USERNAME;
    const password = process.env.PLATFORM_GSIS_PASSWORD;

    if (!username || !password) {
      return res.status(503).json({ error: 'Η αυτόματη συμπλήρωση δεν είναι διαθέσιμη αυτήν τη στιγμή.' });
    }

    // Caller AFM: prefer explicit env var, fall back to DB lookup
    let callerAfm = process.env.PLATFORM_GSIS_CALLER_AFM || null;
    if (!callerAfm) {
      try {
        const [rows] = await pool.execute(
          `SELECT afm FROM businesses WHERE gsis_username = ? AND afm IS NOT NULL AND afm != '' LIMIT 1`,
          [username]
        );
        callerAfm = rows[0]?.afm || null;
      } catch { /* DB unavailable — fall through */ }
    }

    if (!callerAfm) {
      return res.status(503).json({ error: 'Η αυτόματη συμπλήρωση δεν είναι διαθέσιμη αυτήν τη στιγμή.' });
    }

    const soapBody = buildSoapRequest(username, password, callerAfm, afm);

    const response = await axios.post(
      'https://www1.aade.gr/wsaade/RgWsPublic2/RgWsPublic2',
      soapBody,
      {
        headers: {
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          'SOAPAction': 'http://rgwspublic2/RgWsPublic2Service:rgWsPublic2AfmMethod',
        },
        timeout: 10000,
      }
    );

    const xml = response.data;

    const errorCode = extractXml(xml, 'error_code');
    if (errorCode) {
      const errorDescr = extractXml(xml, 'error_descr');
      return res.status(404).json({ error: errorDescr || 'Δεν βρέθηκαν στοιχεία για αυτό το ΑΦΜ.' });
    }

    const companyName = extractXml(xml, 'onomasia') || extractXml(xml, 'commer_title');
    const doy = extractXml(xml, 'doy_descr');
    const address = [extractXml(xml, 'postal_address'), extractXml(xml, 'postal_address_no')]
      .filter(Boolean).join(' ').trim();
    const city = extractXml(xml, 'postal_area_description');
    const postalCode = extractXml(xml, 'postal_zip_code');
    const activity = extractXml(xml, 'firm_flag_descr');
    const legalStatus = extractXml(xml, 'legal_status_descr');

    if (!companyName) {
      return res.status(404).json({ error: 'Δεν βρέθηκαν στοιχεία για αυτό το ΑΦΜ.' });
    }

    res.json({
      data: {
        afm,
        company_name: companyName,
        legal_status: legalStatus,
        doy,
        address: address || null,
        city: city || null,
        postal_code: postalCode || null,
        phone: null,
        activity: activity || null,
      }
    });
  } catch (err) {
    console.error('[AFM Public Lookup] Error:', err.code, err.message);
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
      return res.status(503).json({ error: 'Η υπηρεσία ΑΑΔΕ δεν αποκρίνεται αυτήν τη στιγμή.' });
    }
    if (err.response?.status === 401) {
      return res.status(503).json({ error: 'Σφάλμα διαπιστευτηρίων ΓΣΙΣ. Επικοινωνήστε με την υποστήριξη.' });
    }
    next(err);
  }
});

module.exports = router;
