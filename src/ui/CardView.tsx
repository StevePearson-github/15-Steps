import type { ButtonHTMLAttributes, CSSProperties, MouseEvent } from 'react';
import type { Card } from '../engine';
import { SUIT_SYMBOL, cardLabel, rankLabel } from './controller';

const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const;
const RANK_NAME = ['', 'ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];

/** A card's name for people using a screen reader: "queen of hearts", "joker". */
export function cardName(card: Card): string {
  if (card.kind === 'joker') return 'joker';
  return `${RANK_NAME[card.rank]} of ${SUIT_NAME[card.suit]}${card.rank === 2 ? ' (wild)' : ''}`;
}

interface CardProps {
  card?: Card;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  label?: string;
  small?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Extra button props (pointer and key handlers). Makes the card a button even without onClick. */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  /** Whether pressing the card toggles a selection (sets aria-pressed). */
  selectable?: boolean;
  /** A small count badge on the corner of a face-down card (the number of cards in a pile). */
  badge?: number | string;
}

/**
 * A single card. Its look comes entirely from CSS variables and classes, so
 * decks can be re-themed later without touching this component.
 */
export function CardView({ card, faceDown, selected, onClick, label, small, className, style, buttonProps, selectable, badge }: CardProps) {
  const classes = ['card'];
  if (small) classes.push('small');
  if (selected) classes.push('selected');
  if (onClick || buttonProps) classes.push('clickable');
  if (className) classes.push(className);

  let content;
  if (faceDown || !card) {
    classes.push('back');
    content = (
      <>
        <span className="emblem"><b>15</b><i>steps</i></span>
        {badge !== undefined && <span className="badge">{badge}</span>}
      </>
    );
  } else if (card.kind === 'joker') {
    classes.push('joker');
    content = (
      <>
        <span className="joker-star" aria-hidden="true">★</span>
        <span className="joker-text">JOKER</span>
        <span className="wild-tag">WILD</span>
      </>
    );
  } else {
    const symbol = SUIT_SYMBOL[card.suit];
    classes.push(card.suit === 'H' || card.suit === 'D' ? 'red' : 'black');
    if (card.rank === 2) classes.push('wild');
    const index = (
      <>
        <span className="rank">{rankLabel(card.rank)}</span>
        <span className="pip">{symbol}</span>
      </>
    );
    content = (
      <>
        <span className="index tl">{index}</span>
        <span className="center-pip" aria-hidden="true">{symbol}</span>
        {card.rank === 2 && <span className="wild-tag">WILD</span>}
      </>
    );
  }

  // A face-up card is named by its face; any other label (like "Take the discard") is added after it.
  const name = faceDown || !card ? label : `${cardName(card)}${label && label !== cardLabel(card) ? ` — ${label}` : ''}`;
  const common = { className: classes.join(' '), 'data-card': card?.id };
  return onClick || buttonProps ? (
    <button
      type="button"
      {...common}
      {...buttonProps}
      style={style}
      onClick={onClick}
      aria-pressed={selectable === false ? undefined : selected}
      aria-label={name}
      title={name}
    >
      {content}
    </button>
  ) : (
    <div {...common} style={style}>
      {content}
    </div>
  );
}
