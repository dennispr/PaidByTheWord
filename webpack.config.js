
const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './TopWordsEngine.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      {
        test: /\.(png|jpg|gif|svg|ttf|woff2?|eot|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: 'styles.css' }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'index.html', to: 'index.html' },
        { from: 'books.pack.js', to: 'books.pack.js', noErrorOnMissing: true },
        { from: 'headlinertitle.png', to: 'headlinertitle.png', noErrorOnMissing: true },
        { from: 'title.png', to: 'title.png', noErrorOnMissing: true },
        { from: 'fonts', to: 'fonts', noErrorOnMissing: true },
        { from: '*.css', to: '[name][ext]', noErrorOnMissing: true },
        { from: '*.epub', to: '[name][ext]', noErrorOnMissing: true },
        // Copy only the word files actually used by the game
        { from: 'words/bookwords.pack.js', to: 'words/bookwords.pack.js', noErrorOnMissing: true },
        { from: 'words/*-wordcount.js', to: 'words/[name][ext]', noErrorOnMissing: true },
      ],
    }),
  ],
  devtool: 'source-map',
  mode: 'development',
};
