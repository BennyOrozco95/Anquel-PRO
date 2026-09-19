/**
 * Anaqueles Pro — SyncEndpoint.gs
 * Sincronización de catálogo + conversión de imágenes Drive a base64
 *
 * Columnas esperadas:
 * A = Nombre
 * B = Requeridos lunes a viernes / requerido base
 * C = Requeridos sábado (opcional; si está vacío, la app usa B)
 * D = Rellenar / columna libre heredada
 * E = Imagen
 * F = Activo Yes/No
 * G = Reportar si faltan desde
 * H = Unidades por paquete
 * I = Ubicación dentro del proveedor (por ejemplo: Refrigerador o Anaquel)
 * J = ID de agrupación opcional para sumar el mismo producto entre ubicaciones
 *
 * Hoja opcional "Calendario Pedidos":
 * A = Proveedor, B = Lunes, C = Martes, D = Miércoles, E = Jueves,
 * F = Viernes, G = Sábado, H = Domingo. Usa Yes/No, Sí/No, X o 1/0.
 *
 * Uso normal:
 * TU_URL_WEBAPP
 *
 * Uso con imágenes base64:
 * TU_URL_WEBAPP?includeImages=1
 *
 * Proxy individual de imagen:
 * TU_URL_WEBAPP?mode=image&url=URL_DE_IMAGEN
 */

const HOJAS_IGNORAR = new Set([
  'Menu',
  'Hoja 12',
  'Hoja 13',
  'Hoja 14',
  'Hoja 15',
  'Demo',
  'Calendario Pedidos',
  'Calendario de Pedidos',
  'CalendarioPedidos'
]);

const ENDPOINT_VERSION = 6;

/**
 * Entrada principal del Web App.
 */
function doGet(e) {
  e = e || { parameter: {} };

  try {
    if (e.parameter && e.parameter.mode === 'image') {
      return imageProxy_(e);
    }

    const includeImages = String(
      e.parameter.includeImages ||
      e.parameter.images ||
      ''
    ) === '1';

    const sections = leerTodasLasSecciones(includeImages);

    return respuestaJSON({
      ok: true,
      version: ENDPOINT_VERSION,
      includeImages: includeImages,
      syncedAt: Date.now(),
      sections: sections
    });

  } catch (err) {
    Logger.log('Error en doGet: ' + err.message);

    return respuestaJSON({
      ok: false,
      version: ENDPOINT_VERSION,
      error: err.message
    });
  }
}

/**
 * Lee todas las hojas del Google Sheet.
 */
function leerTodasLasSecciones(includeImages) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sections = [];
  const calendario = leerCalendarioPedidos_(ss);

  ss.getSheets().forEach(function(sheet) {
    const nombreHoja = sheet.getName();

    if (HOJAS_IGNORAR.has(nombreHoja)) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const numRows = lastRow - 1;

    const valores = sheet.getRange(2, 1, numRows, 10).getValues();
    const formulas = sheet.getRange(2, 1, numRows, 10).getFormulas();

    let formulasK = [];
    let valoresK = [];

    try {
      formulasK = sheet.getRange(2, 11, numRows, 1).getFormulas();
      valoresK = sheet.getRange(2, 11, numRows, 1).getValues();
    } catch (e) {
      formulasK = [];
      valoresK = [];
    }

    const products = [];

    valores.forEach(function(fila, i) {
      const nombre = String(fila[0] || '').trim();
      if (!nombre) return;

      const requeridosBase = normalizarEnteroNoNegativo(fila[1], 0);
      const requeridosSabado = normalizarEnteroOpcional(fila[2]);

      let imageUrl = extraerUrlImagenDesdeCelda_(fila[4], formulas[i][4]);

      if (!imageUrl && formulasK[i] && formulasK[i][0]) {
        imageUrl = extraerUrlImagenDesdeCelda_(
          valoresK[i] ? valoresK[i][0] : '',
          formulasK[i][0]
        );
      }

      const activo = String(fila[5] || '').trim().toLowerCase();

      if (activo === 'no') return;

      const minMissing = normalizarEnteroPositivo(fila[6], 1);
      const packageSize = normalizarEnteroPositivo(fila[7], 1);
      const location = String(fila[8] || '').trim();
      const groupId = String(fila[9] || '').trim();

      const product = {
        id: crearIdProducto_(nombre, i + 2),
        name: nombre,
        // Compatibilidad hacia atrás: "required" sigue siendo la columna B.
        // La app nueva de Pedidos usará requiredSaturday cuando el modo activo sea sábado.
        required: requeridosBase,
        requiredWeekday: requeridosBase,
        requiredBase: requeridosBase,
        requiredSaturday: requeridosSabado,
        requiredSabado: requeridosSabado,
        requeridoSabado: requeridosSabado,
        imageUrl: imageUrl,
        minMissing: minMissing,
        packageSize: packageSize,
        location: location,
        groupId: groupId
      };

      if (includeImages && imageUrl) {
        try {
          const img = convertirImagenADataUrl_(imageUrl);

          product.imageDataUrl = img.dataUrl;
          product.imageOfflineUrl = img.dataUrl;
          product.imageContentType = img.contentType;
          product.imageSize = img.size;
          product.imageSource = img.source;

        } catch (imgErr) {
          Logger.log(
            'No se pudo incrustar imagen de "' +
            nombre +
            '": ' +
            imgErr.message +
            ' | URL: ' +
            imageUrl
          );

          product.imageError = imgErr.message;
        }
      }

      products.push(product);
    });

    if (products.length > 0) {
      const providerKey = normalizarClave_(nombreHoja);
      const orderDays = calendario.byProvider.has(providerKey)
        ? Array.from(calendario.byProvider.get(providerKey)).sort()
        : [];

      sections.push({
        id: 'sec_' + nombreHoja.replace(/\W+/g, '_'),
        name: nombreHoja,
        products: products,
        scheduleConfigured: calendario.configured,
        orderDays: orderDays
      });
    }
  });

  return sections;
}

/**
 * Lee la hoja administrativa que decide qué proveedores aparecen cada día.
 * Si la hoja no existe, "configured" será false y la app mostrará todos.
 */
function leerCalendarioPedidos_(ss) {
  const nombres = [
    'Calendario Pedidos',
    'Calendario de Pedidos',
    'CalendarioPedidos'
  ];
  let sheet = null;

  for (let i = 0; i < nombres.length; i++) {
    sheet = ss.getSheetByName(nombres[i]);
    if (sheet) break;
  }

  const byProvider = new Map();
  if (!sheet) return { configured: false, byProvider: byProvider };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { configured: true, byProvider: byProvider };

  const rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const dayByColumn = [1, 2, 3, 4, 5, 6, 0]; // Lunes ... Domingo

  rows.forEach(function(row) {
    const provider = String(row[0] || '').trim();
    if (!provider) return;

    const key = normalizarClave_(provider);
    const activeDays = byProvider.get(key) || new Set();

    dayByColumn.forEach(function(day, index) {
      if (esValorActivo_(row[index + 1])) activeDays.add(day);
    });

    byProvider.set(key, activeDays);
  });

  return { configured: true, byProvider: byProvider };
}

function esValorActivo_(value) {
  if (value === true || value === 1) return true;
  const normalized = normalizarClave_(value);
  return ['si', 'yes', 'x', '1', 'true', 'activo'].includes(normalized);
}

function normalizarClave_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Extrae URL desde fórmula =IMAGE("url") o desde valor directo.
 */
function extraerUrlImagenDesdeCelda_(valor, formula) {
  formula = String(formula || '').trim();
  valor = String(valor || '').trim();

  const matchFormula = formula.match(/IMAGE\(\s*["']([^"']+)["']/i);

  if (matchFormula && matchFormula[1]) {
    return matchFormula[1].trim();
  }

  if (/^https?:\/\//i.test(valor)) {
    return valor;
  }

  return '';
}

/**
 * Crea ID estable para producto.
 */
function crearIdProducto_(nombre, rowNumber) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') + '_r' + rowNumber;
}

/**
 * Convierte un valor a entero no negativo.
 * Permite 0. Útil para requeridos.
 */
function normalizarEnteroNoNegativo(valor, defaultValue) {
  if (valor === undefined || valor === null) return defaultValue;

  const texto = String(valor).trim();

  if (texto === '') return defaultValue;

  const n = Math.floor(Number(texto.replace(',', '.')));

  return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

/**
 * Convierte un valor opcional a entero no negativo.
 * Vacío / inválido = null.
 * Esto permite que la app detecte que no hay requerido especial de sábado
 * y use la columna B como respaldo.
 */
function normalizarEnteroOpcional(valor) {
  if (valor === undefined || valor === null) return null;

  const texto = String(valor).trim();

  if (texto === '') return null;

  const n = Math.floor(Number(texto.replace(',', '.')));

  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Convierte un valor a entero positivo.
 */
function normalizarEnteroPositivo(valor, defaultValue) {
  const n = Math.floor(Number(valor));

  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/**
 * Respuesta JSON.
 */
function respuestaJSON(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Proxy individual para probar una imagen.
 */
function imageProxy_(e) {
  try {
    const url = String(
      (e.parameter && (e.parameter.url || e.parameter.imageUrl)) || ''
    ).trim();

    if (!url) {
      throw new Error('Falta el parámetro url');
    }

    const img = convertirImagenADataUrl_(url);

    return respuestaJSON({
      ok: true,
      url: url,
      contentType: img.contentType,
      size: img.size,
      source: img.source,
      dataUrl: img.dataUrl
    });

  } catch (err) {
    Logger.log('Error en imageProxy_: ' + err.message);

    return respuestaJSON({
      ok: false,
      error: err.message
    });
  }
}

/**
 * Convierte cualquier URL de imagen compatible a data:image/...base64.
 */
function convertirImagenADataUrl_(url) {
  const blob = obtenerBlobImagenDesdeUrl_(url);

  let contentType = String(blob.getContentType() || '').toLowerCase();

  if (!/^image\//i.test(contentType)) {
    contentType = adivinarTipoImagen_(url);
  }

  const bytes = blob.getBytes();

  if (!bytes || !bytes.length) {
    throw new Error('La imagen está vacía');
  }

  const base64 = Utilities.base64Encode(bytes);

  return {
    contentType: contentType,
    size: bytes.length,
    source: blob.__source || 'unknown',
    dataUrl: 'data:' + contentType + ';base64,' + base64
  };
}

/**
 * Obtiene el Blob de la imagen.
 * Orden de intentos:
 * 1. DriveApp, si es imagen de Drive.
 * 2. Drive API con token OAuth.
 * 3. URLs públicas alternativas.
 * 4. URL original.
 */
function obtenerBlobImagenDesdeUrl_(url) {
  url = String(url || '').trim();

  const driveId = extraerDriveFileId_(url);
  const errores = [];

  /**
   * 1. DriveApp.
   * Es el método más fiable cuando el archivo está en el Drive de la cuenta
   * que ejecuta Apps Script o está compartido con esa cuenta.
   */
  if (driveId) {
    try {
      const file = DriveApp.getFileById(driveId);
      const blob = file.getBlob();

      validarBlobImagen_(blob);

      blob.__source = 'DriveApp';

      return blob;

    } catch (err) {
      errores.push('DriveApp: ' + err.message);
    }
  }

  /**
   * 2. Drive API vía UrlFetchApp + OAuth token.
   */
  if (driveId) {
    try {
      const apiUrl =
        'https://www.googleapis.com/drive/v3/files/' +
        encodeURIComponent(driveId) +
        '?alt=media';

      const blob = obtenerBlobPorUrlFetch_(apiUrl, {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
      });

      blob.__source = 'Drive API alt=media';

      return blob;

    } catch (err) {
      errores.push('Drive API: ' + err.message);
    }
  }

  /**
   * 3. URLs públicas candidatas.
   */
  const urls = [];

  if (driveId) {
    urls.push(
      'https://drive.google.com/thumbnail?id=' +
      encodeURIComponent(driveId) +
      '&sz=w420'
    );

    urls.push(
      'https://lh3.googleusercontent.com/d/' +
      encodeURIComponent(driveId) +
      '=s420'
    );

    urls.push(
      'https://drive.google.com/uc?export=download&id=' +
      encodeURIComponent(driveId)
    );
  }

  urls.push(url);

  for (let i = 0; i < urls.length; i++) {
    try {
      const blob = obtenerBlobPorUrlFetch_(urls[i], {
        'User-Agent': 'Mozilla/5.0 AnaquelesProImageProxy'
      });

      blob.__source = 'UrlFetch público';

      return blob;

    } catch (err) {
      errores.push('UrlFetch: ' + err.message + ' | ' + urls[i]);
    }
  }

  throw new Error(
    'No se pudo descargar la imagen. Detalle: ' + errores.join(' || ')
  );
}

/**
 * Descarga un Blob por URL.
 */
function obtenerBlobPorUrlFetch_(url, headers) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: headers || {}
  });

  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code);
  }

  const blob = response.getBlob();

  validarBlobImagen_(blob);

  return blob;
}

/**
 * Valida que un blob sea imagen real.
 */
function validarBlobImagen_(blob) {
  if (!blob) {
    throw new Error('Blob vacío');
  }

  const bytes = blob.getBytes();

  if (!bytes || !bytes.length) {
    throw new Error('Respuesta de imagen vacía');
  }

  const contentType = String(blob.getContentType() || '').toLowerCase();

  if (!/^image\//i.test(contentType)) {
    throw new Error('La respuesta no es imagen: ' + contentType);
  }
}

/**
 * Extrae el ID de archivo de Google Drive desde distintas variantes de URL.
 */
function extraerDriveFileId_(url) {
  url = String(url || '');

  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /open\?id=([a-zA-Z0-9_-]{20,})/,
    /googleusercontent\.com\/d\/([a-zA-Z0-9_-]{20,})/
  ];

  for (let i = 0; i < patterns.length; i++) {
    const m = url.match(patterns[i]);

    if (m && m[1]) {
      return m[1];
    }
  }

  return '';
}

/**
 * Adivina tipo de imagen si el servidor no lo devuelve bien.
 */
function adivinarTipoImagen_(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();

  if (/\.png$/.test(clean)) return 'image/png';
  if (/\.webp$/.test(clean)) return 'image/webp';
  if (/\.gif$/.test(clean)) return 'image/gif';
  if (/\.svg$/.test(clean)) return 'image/svg+xml';

  return 'image/jpeg';
}

/**
 * Prueba general del endpoint desde el editor de Apps Script.
 */
function probarEndpoint() {
  const secciones = leerTodasLasSecciones(true);

  Logger.log('Secciones encontradas: ' + secciones.length);

  secciones.forEach(function(section) {
    Logger.log(section.name + ': ' + section.products.length + ' productos');

    section.products.slice(0, 10).forEach(function(product) {
      Logger.log(
        product.name +
        ' | Req B/L-V: ' + product.requiredWeekday +
        ' | Req C/Sáb: ' + (product.requiredSaturday === null ? 'sin especial' : product.requiredSaturday) +
        ' | Img URL: ' + (product.imageUrl ? 'sí' : 'no') +
        ' | Img base64: ' + (product.imageDataUrl ? 'sí' : 'no') +
        (product.imageError ? ' | Error: ' + product.imageError : '') +
        (product.imageSource ? ' | Source: ' + product.imageSource : '')
      );
    });
  });
}

/**
 * Prueba directa con una imagen de Drive.
 * Puedes cambiar el ID por cualquier imagen problemática.
 */
function probarProxyImagenDrive() {
  const e = {
    parameter: {
      mode: 'image',
      url: 'https://drive.google.com/thumbnail?id=10Nu5la2ua-SB9g6-HCp_yP1_gzmnLwAk'
    }
  };

  const resp = imageProxy_(e).getContent();

  Logger.log(resp.substring(0, 1500));
}
