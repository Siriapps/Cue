const dotenv = require('dotenv');
const path = require('path');
const webpack = require('webpack');

// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

module.exports = {
  webpack: {
    configure: (config) => {
      // Exclude node_modules from source-map-loader to avoid 30+ "Failed to parse source map" warnings
      const useSourceMapLoader = (use) => {
        if (Array.isArray(use)) return use.some((u) => u?.loader?.includes?.('source-map-loader'));
        return use?.loader?.includes?.('source-map-loader');
      };
      const applyExclude = (rules) => {
        if (!Array.isArray(rules)) return;
        rules.forEach((r) => {
          if (r.enforce === 'pre' && useSourceMapLoader(r.use)) r.exclude = /node_modules/;
          if (r.oneOf) applyExclude(r.oneOf);
        });
      };
      applyExclude(config.module.rules);
      return config;
    },
    plugins: {
      add: [
        new webpack.DefinePlugin({
          'process.env.REACT_APP_GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID || ''),
          'process.env.REACT_APP_API_BASE_URL': JSON.stringify(process.env.API_BASE_URL || 'http://localhost:8000'),
          'process.env.REACT_APP_WS_BASE_URL': JSON.stringify(process.env.WS_BASE_URL || 'ws://localhost:8000'),
          'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
          'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
        }),
      ],
    },
  },
};
