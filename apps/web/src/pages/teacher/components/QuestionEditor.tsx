import { Add, DeleteOutline } from "@mui/icons-material";
import { IconButton, MenuItem, TextField } from "@mui/material";

export type DraftQuestion = {
  type: string;
  prompt: string;
  marks: number;
  correctAnswer?: unknown;
  options: { label: string; value: string; isCorrect: boolean }[];
};

export default function QuestionEditor({
  value,
  index,
  onChange,
  onDelete,
}: {
  value: DraftQuestion;
  index: number;
  onChange: (q: DraftQuestion) => void;
  onDelete: () => void;
}) {
  const set = (patch: Partial<DraftQuestion>) =>
    onChange({ ...value, ...patch });
  const addOption = () =>
    set({
      options: [
        ...value.options,
        {
          label: String.fromCharCode(65 + value.options.length),
          value: "",
          isCorrect: false,
        },
      ],
    });
  return (
    <div className="rounded-[26px] border border-white/80 bg-white/75 p-5 shadow-[0_18px_50px_rgba(71,85,180,.10)] backdrop-blur-xl transition hover:-translate-y-1">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <span className="text-xs font-black uppercase tracking-[.2em] text-indigo-500">
            Question {index + 1}
          </span>
          <h3 className="font-black text-slate-800">Build question</h3>
        </div>
        <IconButton onClick={onDelete}>
          <DeleteOutline />
        </IconButton>
      </div>
      <div className="grid gap-4 md:grid-cols-[180px_1fr_120px]">
        <TextField
          select
          label="Type"
          value={value.type}
          onChange={(e) =>
            set({
              type: e.target.value,
              options: ["MCQ", "MULTI_SELECT"].includes(e.target.value)
                ? value.options.length
                  ? value.options
                  : [
                      { label: "A", value: "", isCorrect: true },
                      { label: "B", value: "", isCorrect: false },
                    ]
                : [],
            })
          }
        >
          {[
            "MCQ",
            "MULTI_SELECT",
            "TRUE_FALSE",
            "FILL_BLANK",
            "SHORT_ANSWER",
            "LONG_ANSWER",
            "NUMERIC",
            "ESSAY",
          ].map((t) => (
            <MenuItem key={t} value={t}>
              {t.replaceAll("_", " ")}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Question"
          value={value.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          multiline
        />
        <TextField
          label="Marks"
          type="number"
          value={value.marks}
          onChange={(e) => set({ marks: Math.max(1, Number(e.target.value)) })}
        />
      </div>
      {["MCQ", "MULTI_SELECT"].includes(value.type) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {value.options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  set({
                    options: value.options.map((x, oi) => ({
                      ...x,
                      isCorrect:
                        value.type === "MULTI_SELECT"
                          ? oi === i
                            ? !x.isCorrect
                            : x.isCorrect
                          : oi === i,
                    })),
                  })
                }
                className={`h-12 w-12 rounded-2xl font-black transition ${o.isCorrect ? "bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-lg" : "bg-slate-100 text-slate-500"}`}
              >
                {o.label}
              </button>
              <TextField
                fullWidth
                label={`Option ${o.label}`}
                value={o.value}
                onChange={(e) =>
                  set({
                    options: value.options.map((x, oi) =>
                      oi === i ? { ...x, value: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-300 font-bold text-indigo-600"
          >
            <Add /> Add option
          </button>
        </div>
      )}
      {!["MCQ", "MULTI_SELECT"].includes(value.type) && (
        <TextField
          className="mt-4"
          fullWidth
          label="Correct answer / marking reference"
          value={String(value.correctAnswer ?? "")}
          onChange={(e) => set({ correctAnswer: e.target.value })}
        />
      )}
    </div>
  );
}
