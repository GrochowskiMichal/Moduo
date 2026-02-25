import React, { CSSProperties, forwardRef } from "react";
import { createPortal } from "react-dom";

type BaseProps = {
  className?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
};

function toClampStyle(numberOfLines?: number): CSSProperties | undefined {
  if (!numberOfLines || numberOfLines <= 0) return undefined;
  return {
    display: "-webkit-box",
    WebkitLineClamp: numberOfLines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

function resolveImageSource(source: any): string {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") {
    if (typeof source.uri === "string") return source.uri;
    if (typeof source.default === "string") return source.default;
  }
  return "";
}

export const View = forwardRef<HTMLDivElement, BaseProps & React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, children, ...rest }, ref) => (
    <div ref={ref} className={className} style={style} {...rest}>
      {children}
    </div>
  )
);
View.displayName = "View";

type TextProps = BaseProps & {
  as?: "span" | "div" | "p";
  numberOfLines?: number;
} & React.HTMLAttributes<HTMLElement>;

export const Text = ({ as = "span", className, style, children, numberOfLines, ...rest }: TextProps) => {
  const Component = as;
  return (
    <Component className={className} style={{ ...toClampStyle(numberOfLines), ...style }} {...rest}>
      {children}
    </Component>
  );
};

type PressableProps = BaseProps & {
  onPress?: (event: any) => void;
  disabled?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

export const Pressable = ({ onPress, onClick, disabled, className, style, children, ...rest }: PressableProps) => (
  <div
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-disabled={disabled || undefined}
    className={className}
    style={{ cursor: disabled ? "not-allowed" : "pointer", ...style }}
    onClick={(event) => {
      if (disabled) return;
      onPress?.(event);
      onClick?.(event as any);
    }}
    onKeyDown={(event) => {
      if (disabled) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPress?.(event);
      }
    }}
    {...rest}
  >
    {children}
  </div>
);

type TextInputProps = BaseProps & {
  value?: string;
  onChangeText?: (value: string) => void;
  multiline?: boolean;
  numberOfLines?: number;
  placeholderTextColor?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad" | "numeric";
  textAlignVertical?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">;

export const TextInput = ({
  value,
  onChangeText,
  multiline,
  className,
  style,
  numberOfLines,
  keyboardType,
  secureTextEntry,
  ...rest
}: TextInputProps) => {
  const rows = numberOfLines && numberOfLines > 0 ? numberOfLines : 3;

  if (multiline) {
    return (
      <textarea
        className={className}
        style={style}
        rows={rows}
        value={value ?? ""}
        onChange={(event) => onChangeText?.(event.target.value)}
        {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    );
  }

  const type = secureTextEntry ? "password" : keyboardType === "email-address" ? "email" : keyboardType === "number-pad" || keyboardType === "numeric" ? "number" : "text";

  return (
    <input
      className={className}
      style={style}
      type={type}
      value={value ?? ""}
      onChange={(event) => onChangeText?.(event.target.value)}
      {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
    />
  );
};

type ImageProps = BaseProps & {
  source: any;
  alt?: string;
  contentFit?: "contain" | "cover" | "fill";
} & React.ImgHTMLAttributes<HTMLImageElement>;

export const Image = ({ source, alt = "", contentFit = "cover", className, style, ...rest }: ImageProps) => (
  <img
    src={resolveImageSource(source)}
    alt={alt}
    className={className}
    style={{ objectFit: contentFit, ...style }}
    {...rest}
  />
);

type ModalProps = {
  visible: boolean;
  transparent?: boolean;
  animationType?: "none" | "fade" | "slide";
  onRequestClose?: () => void;
  children: React.ReactNode;
};

export const Modal = ({ visible, children }: ModalProps) => {
  if (!visible || typeof document === "undefined") return null;
  return createPortal(<>{children}</>, document.body);
};

type ScrollViewProps = BaseProps & {
  horizontal?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  contentContainerStyle?: CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>;

export const ScrollView = ({
  horizontal,
  className,
  style,
  children,
  contentContainerStyle,
  ...rest
}: ScrollViewProps) => {
  const baseStyle: CSSProperties = horizontal
    ? { overflowX: "auto", overflowY: "hidden", whiteSpace: "nowrap" }
    : { overflowY: "auto", overflowX: "hidden" };

  return (
    <div className={className} style={{ ...baseStyle, ...style }} {...rest}>
      <div style={contentContainerStyle}>{children}</div>
    </div>
  );
};

export const ActivityIndicator = ({ className }: { className?: string }) => (
  <div className={className} aria-label="loading">
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#9aa0aa] border-t-transparent" />
  </div>
);
