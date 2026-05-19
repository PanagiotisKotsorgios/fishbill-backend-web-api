/**
 * Returns middleware that validates req[target] against a Joi schema.
 * On failure, responds with 422 and validation error details.
 * @param {import('joi').Schema} schema - Joi schema
 * @param {'body'|'query'|'params'} target - which part of the request to validate
 */
function validate(schema, target = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[target], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(422).json({
        error: 'Ελέγξτε τα στοιχεία που γράψατε.',
        details,
      });
    }

    // Replace with the sanitized/stripped value
    req[target] = value;
    next();
  };
}

module.exports = { validate };
