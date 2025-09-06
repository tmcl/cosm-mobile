#!/usr/bin/env bash
set -exu
PREBUILD_DIR=$(git rev-parse --show-toplevel)/expo-prebuild-template-cache
cd $PREBUILD_DIR
git rm -rf state.json template-cache || true
rm -rf ~/.expo
echo $PWD
cd ..
echo $PWD
yarn install
yarn run expo prebuild --platform android
cd $PREBUILD_DIR
cp -av ~/.expo/* .
git add .
