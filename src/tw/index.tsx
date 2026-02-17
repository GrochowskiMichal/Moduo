import React from "react";
import { useCssElement } from "react-native-css";
import {
  Pressable as RNPressable,
  Text as RNText,
  TextInput as RNTextInput,
  View as RNView,
} from "react-native";
import { Image as ExpoImage } from "expo-image";

export const View = (props: any) =>
  useCssElement(RNView as any, props, { className: "style" });

export const Text = (props: any) =>
  useCssElement(RNText as any, {
    ...props,
    style: [{ fontFamily: "Inter_400Regular" }, props?.style],
  }, { className: "style" });

export const Pressable = (props: any) =>
  useCssElement(RNPressable as any, props, { className: "style" });

export const TextInput = (props: any) =>
  useCssElement(RNTextInput as any, {
    ...props,
    style: [{ fontFamily: "Inter_400Regular" }, props?.style],
  }, { className: "style" });

export const Image = (props: any) =>
  useCssElement(ExpoImage as any, props, { className: "style" });
