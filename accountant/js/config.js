// PRODUCTION: change API_URL to your live API domain.
const CONFIG = {
  API_URL: 'https://master-app.gr/api',
  APP_NAME: 'FishBill Λογιστές',
  VERSION: '1.0.0',
  get DEBUG() {
    return this._debug || localStorage.getItem('fishbill_debug') === '1';
  },
  set DEBUG(v) {
    this._debug = !!v;
    v ? localStorage.setItem('fishbill_debug', '1') : localStorage.removeItem('fishbill_debug');
  },
  _debug: false,
};
window.CONFIG = CONFIG;
