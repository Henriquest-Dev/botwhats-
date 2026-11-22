// Configuração inicial de um vendedor novo (editável depois no painel).
export const defaultConfig = phone => ({
  businessName: 'Os Meus Megas',
  admins: [phone],
  groupSettings: {},
  privateChats: true,
  replyUnknownInPrivate: true,
  acceptImageProofs: true,
  paymentAccounts: [{ provider: 'M-Pesa', number: phone, name: 'O teu nome' }],
  packages: [
    { name: '1GB Vodacom', price: 50, validity: '24h' },
    { name: '2GB Vodacom', price: 90, validity: '7 dias' },
    { name: '5GB Vodacom', price: 200, validity: '30 dias' },
  ],
  minutesPerOrder: 3,
  reminderMinutes: 10,
  maxWarnings: 3,
  autoAlertReports: 3,
  timezone: 'Africa/Maputo',
  hours: null,
  ai: { enabled: true, answerQuestions: true, cooldownSeconds: 8, extraInfo: '' },
});
