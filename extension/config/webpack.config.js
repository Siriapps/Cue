const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

const rootDir = path.resolve(__dirname, '../..');

module.exports = {
  entry: {
    popup: path.resolve(rootDir, 'extension/popup/popup.jsx'),
    background: path.resolve(rootDir, 'extension/background/background.js'),
    content: path.resolve(rootDir, 'extension/content/content.js'),
    summary: path.resolve(rootDir, 'extension/summary/SummaryApp.jsx'),
    library: path.resolve(rootDir, 'extension/library/LibraryApp.jsx')
  },
  output: {
    path: path.resolve(rootDir, 'dist'),
    filename: '[name].bundle.js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: path.resolve(rootDir, 'extension/manifest.json'), to: 'manifest.json' },
        { from: path.resolve(rootDir, 'extension/popup/popup.html'), to: 'popup.html' },
        { from: path.resolve(rootDir, 'extension/popup/popup.css'), to: 'popup.css' },
        { from: path.resolve(rootDir, 'extension/summary/summary.html'), to: 'summary.html' },
        { from: path.resolve(rootDir, 'extension/summary/summary.css'), to: 'summary.css' },
        { from: path.resolve(rootDir, 'extension/library/library.html'), to: 'library.html' },
        { from: path.resolve(rootDir, 'extension/library/library.css'), to: 'library.css' },
        { from: path.resolve(rootDir, 'extension/content/halo-strip.css'), to: 'halo-strip.css' },
        { from: path.resolve(rootDir, 'extension/icons'), to: 'icons', noErrorOnMissing: true }
      ]
    })
  ]
};
