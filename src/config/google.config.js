/**
 * Configuración de Google Cloud Platform
 */

export const googleConfig = {
  // APIs habilitadas
  enabledApis: {
    maps: true,
    drive: true,
    calendar: true,
    gmail: true,
    sheets: true,
    docs: true,
    youtube: true,
    analytics: true,
    translate: true,
    vision: true
  },

  // Scopes necesarios por API
  scopes: {
    maps: [
      'https://www.googleapis.com/auth/maps',
      'https://www.googleapis.com/auth/maps.static'
    ],
    drive: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata'
    ],
    calendar: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    gmail: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly'
    ],
    sheets: [
      'https://www.googleapis.com/auth/spreadsheets'
    ],
    docs: [
      'https://www.googleapis.com/auth/documents'
    ],
    youtube: [
      'https://www.googleapis.com/auth/youtube'
    ],
    analytics: [
      'https://www.googleapis.com/auth/analytics.readonly'
    ],
    translate: [
      'https://www.googleapis.com/auth/cloud-translation'
    ],
    vision: [
      'https://www.googleapis.com/auth/cloud-vision'
    ]
  },

  // Configuración de archivos
  fileUpload: {
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: {
      images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
      documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      data: ['application/json', 'text/csv', 'application/xml'],
      audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
      video: ['video/mp4', 'video/webm']
    }
  },

  // Límites por plan
  limits: {
    free: {
      googleApis: 2,
      storage: 100 * 1024 * 1024, // 100MB
      filesPerApp: 10
    },
    basic: {
      googleApis: 5,
      storage: 500 * 1024 * 1024, // 500MB
      filesPerApp: 25
    },
    pro: {
      googleApis: -1, // Ilimitado
      storage: 2 * 1024 * 1024 * 1024, // 2GB
      filesPerApp: 100
    },
    enterprise: {
      googleApis: -1,
      storage: 10 * 1024 * 1024 * 1024, // 10GB
      filesPerApp: -1
    }
  }
};