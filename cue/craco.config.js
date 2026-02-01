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
  },
};
