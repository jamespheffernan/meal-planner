# Drag & Drop Meal Planning Feature

## Overview

Added full drag and drop functionality to the meal planner, allowing users to:
1. Drag meals from "This Week's Meals" to specific calendar slots
2. Drag meals between calendar slots to rearrange them
3. Visual feedback during drag operations

## Features Implemented

### 1. Drag from Staged Meals to Calendar

**What it does:**
- Drag a meal from the "This Week's Meals" section
- Drop it on any empty calendar slot
- Automatically creates a meal plan with 2 servings (for 2 people)
- Reduces the staged meal servings by 2
- Removes staged meal if servings reach 0

**Example:**
```
Staged Meal: Pasta (8 servings)
↓ Drag to Monday Lunch
Result:
- Monday Lunch: Pasta (2 servings) ✅
- Staged: Pasta (6 servings remaining)
```

### 2. Drag Between Calendar Slots

**What it does:**
- Drag an existing meal card from one calendar slot
- Drop it on another empty slot
- Moves the meal to the new date/meal type
- Preserves serving count and all meal properties

**Example:**
```
Monday Lunch: Pasta (2 servings)
↓ Drag to Wednesday Dinner
Result:
- Monday Lunch: Empty
- Wednesday Dinner: Pasta (2 servings) ✅
```

### 3. Visual Feedback

**Drag indicators:**
- 🔵 **Grip icon** on staged meals (shows it's draggable)
- 🎯 **Empty slots highlight** in blue when dragging
- 👻 **Opacity reduction** on dragged item (50%)
- ✨ **Shadow effect** on hover
- 🖱️ **Cursor changes** to `cursor-move`

**Slot states:**
```
Normal:     border-gray-200 (dashed)
Dragging:   border-blue-400 bg-blue-50 (solid, highlighted)
Occupied:   Shows meal card (not droppable)
```

## Technical Implementation

### State Management

```typescript
const [draggedStagedMeal, setDraggedStagedMeal] = useState<StagedMeal | null>(null)
const [draggedMealPlan, setDraggedMealPlan] = useState<MealPlan | null>(null)
```

### Drag Handlers

**Start Drag:**
```typescript
handleDragStartStagedMeal(meal: StagedMeal)  // From staged meals
handleDragStartMealPlan(mealPlan: MealPlan)  // From calendar
```

**End Drag:**
```typescript
handleDragEnd()  // Clears drag state
```

**Drop on Slot:**
```typescript
handleDropOnSlot(date: Date, mealType: string)
// - Checks if slot is empty
// - Creates meal plan from staged meal OR
// - Moves existing meal plan
```

### Drop Logic

```typescript
if (draggedStagedMeal) {
  // Create new meal plan with 2 servings
  createMealPlanMutation.mutate({
    recipeId: draggedStagedMeal.recipe.id,
    plannedDate: format(date, 'yyyy-MM-dd'),
    mealType,
    servingsPlanned: 2, // For 2 people
  })
  
  // Update staged meal servings
  if (remainingServings > 0) {
    handleUpdateServings(draggedStagedMeal.id, -2)
  } else {
    handleRemoveStagedMeal(draggedStagedMeal.id)
  }
}

if (draggedMealPlan) {
  // Move existing meal
  deleteMutation.mutate(draggedMealPlan.id)
  createMealPlanMutation.mutate({
    recipeId: draggedMealPlan.recipeId,
    plannedDate: format(date, 'yyyy-MM-dd'),
    mealType,
    servingsPlanned: draggedMealPlan.servingsPlanned,
  })
}
```

## User Experience

### Workflow 1: Manual Planning
```
1. Add recipes to "This Week's Meals"
2. Adjust serving counts as needed
3. Drag each meal to specific calendar slots
4. Fine-tune by dragging between slots
```

### Workflow 2: Hybrid Approach
```
1. Add recipes to "This Week's Meals"
2. Click "Auto-Fill Week" for bulk assignment
3. Drag meals to rearrange as desired
```

### Visual Cues

**Staged Meal Card:**
```
┌─────────────────────────┐
│ ≡ 🖼️ Pasta Bolognese   │ ← Grip icon shows draggable
│   dinner · 30 min       │
│   [-] 6 servings [+][x] │
└─────────────────────────┘
     ↓ Drag
```

**Empty Slot (Normal):**
```
┌─────────────┐
│             │
│      +      │ ← Gray dashed border
│             │
└─────────────┘
```

**Empty Slot (During Drag):**
```
┌─────────────┐
│             │
│      +      │ ← Blue solid border + bg
│             │
└─────────────┘
```

**Meal Card in Calendar:**
```
┌─────────────┐
│ Pasta       │ ← Draggable (cursor-move)
│ 2 servings  │
│ [✓] [x]     │
└─────────────┘
```

## Constraints & Validation

### Prevented Actions:
- ❌ Cannot drop on occupied slots
- ❌ Cannot drop on same slot (no-op)
- ❌ Staged meals with < 2 servings can still be dragged (creates 2-serving meal, removes staged)

### Allowed Actions:
- ✅ Drag from staged meals to any empty slot
- ✅ Drag between any calendar slots
- ✅ Drag breakfast to breakfast, lunch/dinner interchangeable
- ✅ Multiple drags from same staged meal (until servings depleted)

## Browser Compatibility

Uses native HTML5 Drag and Drop API:
- `draggable` attribute
- `onDragStart`, `onDragEnd`, `onDragOver`, `onDrop` events
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)

## Accessibility

- Visual indicators (grip icon, hover states)
- Cursor changes to indicate draggable items
- Color-coded feedback during drag
- Still supports keyboard navigation for buttons
- Alternative: Auto-Fill button for users who prefer not to drag

## Future Enhancements (Optional)

- [ ] Drag preview with custom ghost image
- [ ] Swap meals when dropping on occupied slot
- [ ] Batch drag multiple meals
- [ ] Touch/mobile drag support
- [ ] Undo/redo for drag operations
- [ ] Drag from Recipe Pool directly to calendar
- [ ] Animation on successful drop

## Files Modified

### Frontend
- `frontend/src/app/meal-plan/page.tsx`
  - Added drag state management
  - Added drag handlers
  - Made calendar slots droppable
  - Made meal cards draggable
  - Added visual feedback

- `frontend/src/components/StagedMealsList.tsx`
  - Added drag props to interface
  - Made staged meal cards draggable
  - Added grip icon visual indicator
  - Updated helper text

### No Backend Changes Required
- Uses existing `mealPlans.create` and `mealPlans.delete` mutations
- No new API endpoints needed

## Testing Checklist

- [x] Drag staged meal to empty slot
- [x] Drag staged meal multiple times (depletes servings)
- [x] Drag meal between calendar slots
- [x] Visual feedback shows during drag
- [x] Cannot drop on occupied slots
- [x] Servings update correctly
- [x] Progress bars update after drag
- [x] Drag state clears after drop
- [x] Works across different meal types
- [x] Lunch/dinner interchangeability preserved

---

**Status:** ✅ Complete and functional
**Linter Errors:** None
**Ready for:** User testing
