import { createApp } from 'vue';
import App from './app/App.js';

const app = createApp(App);

app.config.errorHandler = (err, instance, info) => {
  console.error('[dandelion] Vue error', info, err);
};

app.mount('#app');