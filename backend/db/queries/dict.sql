-- 类别与标签字典。

-- name: ListCategories :many
SELECT * FROM categories ORDER BY sort_order, slug;

-- name: GetCategory :one
SELECT * FROM categories WHERE slug = $1;

-- name: UpdateCategory :one
UPDATE categories
SET names = COALESCE(sqlc.narg('names')::jsonb, names),
    sort_order = COALESCE(sqlc.narg('sort_order'), sort_order)
WHERE slug = @slug
RETURNING *;

-- name: ListTags :many
SELECT * FROM tags ORDER BY slug;

-- name: ListTagsBySlugs :many
SELECT * FROM tags WHERE slug = ANY(@slugs::text[]);

-- name: GetTag :one
SELECT * FROM tags WHERE slug = $1;

-- name: InsertTag :one
INSERT INTO tags (slug, names) VALUES (@slug, @names) RETURNING *;

-- name: UpdateTag :one
UPDATE tags
SET names = COALESCE(sqlc.narg('names')::jsonb, names),
    active = COALESCE(sqlc.narg('active'), active)
WHERE slug = @slug
RETURNING *;
