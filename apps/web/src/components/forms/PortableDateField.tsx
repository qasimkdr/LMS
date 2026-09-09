import { TextField, type TextFieldProps } from "@mui/material";

type Kind = "date" | "datetime" | "time";

const formats: Record<
  Kind,
  { placeholder: string; pattern: RegExp; hint: string }
> = {
  date: {
    placeholder: "YYYY-MM-DD",
    pattern: /^\d{4}-\d{2}-\d{2}$/,
    hint: "Use YYYY-MM-DD",
  },
  datetime: {
    placeholder: "YYYY-MM-DD HH:mm",
    pattern: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/,
    hint: "Use YYYY-MM-DD HH:mm",
  },
  time: {
    placeholder: "HH:mm",
    pattern: /^\d{2}:\d{2}$/,
    hint: "Use 24-hour HH:mm",
  },
};

export default function PortableDateField({
  kind,
  value,
  onValueChange,
  ...props
}: Omit<TextFieldProps, "type" | "value" | "onChange"> & {
  kind: Kind;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const format = formats[kind];
  const invalid = Boolean(value && !format.pattern.test(value));
  return (
    <TextField
      {...props}
      type="text"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={format.placeholder}
      error={invalid || Boolean(props.error)}
      helperText={invalid ? format.hint : props.helperText}
      inputProps={{ inputMode: "numeric", ...props.inputProps }}
    />
  );
}
