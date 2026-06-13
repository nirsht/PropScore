"use client";

import * as React from "react";
import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Divider,
  Link,
  Paper,
  type PaperProps,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import IndeterminateCheckBoxRoundedIcon from "@mui/icons-material/IndeterminateCheckBoxRounded";

export type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "info"
  | "success"
  | "warning"
  | "error";

export type MultiSelectFilterProps<T> = {
  options: T[];
  /** Empty array = "All" (no filter applied). */
  value: T[];
  /** Emits `[]` when the caller should treat the state as "All". */
  onChange: (next: T[]) => void;
  getOptionLabel: (option: T) => string;
  getOptionKey?: (option: T) => string;
  getOptionColor?: (option: T) => ChipColor;
  /** Shown as a soft chip in the trigger when value === [] (e.g. "All types"). */
  placeholder?: string;
  /** Bold label for the header row inside the dropdown. Defaults to "All". */
  allLabel?: string;
  size?: "small" | "medium";
  /** Optional className passthrough. */
  className?: string;
};

const blankIcon = <CheckBoxOutlineBlankRoundedIcon fontSize="small" />;
const checkedIcon = <CheckBoxRoundedIcon fontSize="small" />;

const COLOR_TO_PALETTE: Record<
  ChipColor,
  "primary" | "secondary" | "info" | "success" | "warning" | "error" | undefined
> = {
  default: undefined,
  primary: "primary",
  secondary: "secondary",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
};

function ColorDot({ color }: { color?: ChipColor }) {
  const palette = color ? COLOR_TO_PALETTE[color] : undefined;
  return (
    <Box
      component="span"
      sx={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        bgcolor: palette ? `${palette}.main` : "action.disabled",
      }}
    />
  );
}

export function MultiSelectFilter<T>(props: MultiSelectFilterProps<T>) {
  const {
    options,
    value,
    onChange,
    getOptionLabel,
    getOptionKey = getOptionLabel,
    getOptionColor,
    placeholder = "All",
    allLabel = "All",
    size = "small",
    className,
  } = props;

  const totalCount = options.length;
  const semanticAll = value.length === 0;

  // pickMode lets the user empty the visible selection while keeping the
  // filter semantic "all" (the parent still sees value=[]). Useful for the
  // "deselect everything and pick exactly one" workflow.
  const [pickMode, setPickMode] = React.useState(false);

  const showAsCleared = semanticAll && pickMode;
  const checked = semanticAll && !pickMode ? options : value;
  const checkedCount = checked.length;

  const checkedKeys = React.useMemo(
    () => new Set(checked.map(getOptionKey)),
    [checked, getOptionKey],
  );

  const commit = React.useCallback(
    (next: T[]) => {
      // any non-empty selection means user is in narrowed mode — exit pickMode.
      if (next.length > 0) setPickMode(false);
      if (next.length === totalCount) {
        onChange([]); // normalize "everything ticked" to canonical empty
      } else {
        onChange(next);
      }
    },
    [onChange, totalCount],
  );

  const onSelectAll = React.useCallback(() => {
    setPickMode(false);
    onChange([]);
  }, [onChange]);

  const onClearAll = React.useCallback(() => {
    setPickMode(true);
    onChange([]);
  }, [onChange]);

  const allChecked = checkedCount === totalCount;
  const noneChecked = checkedCount === 0;

  // Header rendered above the option list inside the dropdown Paper.
  const HeaderRow = (
    <Box
      sx={{
        bgcolor: "background.paper",
        px: 1.25,
        py: 0.75,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ userSelect: "none" }}
      >
        <Checkbox
          size="small"
          disableRipple
          checked={allChecked}
          indeterminate={!allChecked && !noneChecked}
          icon={blankIcon}
          checkedIcon={checkedIcon}
          indeterminateIcon={
            <IndeterminateCheckBoxRoundedIcon fontSize="small" color="primary" />
          }
          onClick={() => {
            if (allChecked) onClearAll();
            else onSelectAll();
          }}
          sx={{ p: 0.25, cursor: "pointer" }}
        />
        <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
          {allLabel}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: "tabular-nums" }}
        >
          {checkedCount} / {totalCount}
        </Typography>
        {!allChecked && (
          <Link
            component="button"
            type="button"
            underline="hover"
            variant="caption"
            onClick={(e) => {
              e.stopPropagation();
              onSelectAll();
            }}
            sx={{ fontWeight: 600 }}
          >
            Select all
          </Link>
        )}
        {!noneChecked && (
          <Link
            component="button"
            type="button"
            underline="hover"
            variant="caption"
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
            sx={{ fontWeight: 600, color: "text.secondary" }}
          >
            Clear
          </Link>
        )}
      </Stack>
      {showAsCleared && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.25, ml: 4 }}
        >
          Nothing selected — pick one or more below.
        </Typography>
      )}
      <Divider sx={{ mt: 0.75 }} />
    </Box>
  );

  const PaperWithHeader = React.useMemo(
    () =>
      function PaperWithHeader(paperProps: PaperProps) {
        const { children, ...rest } = paperProps;
        return (
          <Paper {...rest} sx={{ borderRadius: 2, mt: 0.5, ...rest.sx }}>
            {HeaderRow}
            {children}
          </Paper>
        );
      },
    // HeaderRow closes over current state; rebuild when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allChecked, noneChecked, checkedCount, totalCount, allLabel, showAsCleared],
  );

  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      size={size}
      className={className}
      options={options}
      value={checked}
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={(a, b) => getOptionKey(a) === getOptionKey(b)}
      onChange={(_, next) => commit(next)}
      onClose={() => setPickMode(false)}
      PaperComponent={PaperWithHeader}
      slotProps={{
        listbox: {
          sx: { maxHeight: 320 },
        },
      }}
      renderOption={(optionProps, option) => {
        const key = getOptionKey(option);
        const isChecked = checkedKeys.has(key);
        const color = getOptionColor?.(option);
        const liProps = { ...(optionProps as unknown as Record<string, unknown>) };
        delete liProps.key;
        return (
          <li
            {...(liProps as React.LiHTMLAttributes<HTMLLIElement>)}
            key={key}
            style={{ paddingTop: 4, paddingBottom: 4 }}
          >
            <Checkbox
              size="small"
              disableRipple
              icon={blankIcon}
              checkedIcon={checkedIcon}
              checked={isChecked}
              sx={{ p: 0.25, mr: 1 }}
            />
            {color && <ColorDot color={color} />}
            <Typography
              sx={{
                ml: color ? 1 : 0,
                fontSize: 13,
                flex: 1,
                color: isChecked ? "text.primary" : "text.secondary",
              }}
            >
              {getOptionLabel(option)}
            </Typography>
          </li>
        );
      }}
      renderTags={(tagValue, getTagProps) => {
        // The Autocomplete passes the *internal* value (which is `checked`) here.
        // We render compact summaries based on what filter is effectively applied
        // (semanticAll), not on the visible checkbox state.
        if (semanticAll) {
          return [
            <Chip
              key="__all"
              size="small"
              variant="outlined"
              label={placeholder}
              sx={{
                bgcolor: "action.hover",
                borderStyle: "dashed",
                fontWeight: 500,
              }}
            />,
          ];
        }
        if (checkedCount === totalCount - 1) {
          const missing = options.find((o) => !checkedKeys.has(getOptionKey(o)));
          const missingLabel = missing ? getOptionLabel(missing) : "";
          return [
            <Chip
              key="__all-except"
              size="small"
              variant="outlined"
              label={`All except ${missingLabel}`}
              onDelete={() => onChange([])}
            />,
          ];
        }
        const MAX_VISIBLE = 2;
        const visible = tagValue.slice(0, MAX_VISIBLE);
        const overflow = tagValue.length - visible.length;
        return [
          ...visible.map((option, index) => {
            const tagProps = { ...getTagProps({ index }) } as Record<string, unknown>;
            delete tagProps.key;
            const color = getOptionColor?.(option);
            return (
              <Chip
                {...(tagProps as React.ComponentProps<typeof Chip>)}
                key={getOptionKey(option)}
                size="small"
                label={getOptionLabel(option)}
                color={color && color !== "default" ? color : undefined}
                variant={color && color !== "default" ? "filled" : "outlined"}
              />
            );
          }),
          ...(overflow > 0
            ? [
                <Chip
                  key="__overflow"
                  size="small"
                  variant="outlined"
                  label={`+${overflow}`}
                />,
              ]
            : []),
        ];
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={semanticAll ? undefined : placeholder}
        />
      )}
    />
  );
}
