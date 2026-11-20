/**
 * The booking page's one details step (AC33): the guest's name, email and the
 * host's questions together in the tray under the sentence, opened once a time
 * is picked. The book button walks the fields in this order.
 */

import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { BookingPreview } from "./public-client";
import type { DetailsField } from "./sentence";

export type BookingQuestion = BookingPreview["questions"][number] & { id: string };

/** The element id the book button focuses for a missing field. */
export function detailsFieldId(field: DetailsField, question?: BookingQuestion | null): string {
  if (field === "question") return question ? `book-q-${question.id}` : "book-name";
  return field === "name" ? "book-name" : "book-email";
}

type DetailsStepProps = {
  name: string;
  email: string;
  questions: BookingQuestion[];
  answers: Record<string, string>;
  /** Show the missing fields as invalid (the guest pressed the button once). */
  touched: boolean;
  nameOk: boolean;
  emailOk: boolean;
  onName: (value: string) => void;
  onEmail: (value: string) => void;
  onAnswer: (id: string, value: string) => void;
};

function invalid(touched: boolean, ok: boolean): true | undefined {
  return touched && !ok ? true : undefined;
}

export function DetailsStep({
  name,
  email,
  questions,
  answers,
  touched,
  nameOk,
  emailOk,
  onName,
  onEmail,
  onAnswer,
}: DetailsStepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="book-name">Your name</Label>
        <Input
          id="book-name"
          data-first=""
          placeholder="First and last name"
          autoComplete="name"
          enterKeyHint="next"
          value={name}
          aria-invalid={invalid(touched, nameOk)}
          onChange={(event) => onName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              document.getElementById("book-email")?.focus();
            }
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="book-email">Your email</Label>
        <Input
          id="book-email"
          type="email"
          inputMode="email"
          placeholder="you@company.com"
          autoComplete="email"
          enterKeyHint={questions.length > 0 ? "next" : "go"}
          value={email}
          aria-invalid={invalid(touched, emailOk)}
          onChange={(event) => onEmail(event.target.value)}
        />
      </div>
      {questions.map((question) => {
        const answer = answers[question.id] ?? "";
        return (
          <div key={question.id} className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor={`book-q-${question.id}`}>
              {question.label}{" "}
              {question.required ? null : (
                <span className="font-normal text-muted-foreground">Optional</span>
              )}
            </Label>
            <Input
              id={`book-q-${question.id}`}
              value={answer}
              aria-invalid={invalid(touched, question.required !== true || answer.trim() !== "")}
              onChange={(event) => onAnswer(question.id, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
